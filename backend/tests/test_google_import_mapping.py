from datetime import UTC, datetime
from typing import Any

from studyflow.integrations.google_import import (
    CalendarImportItem,
    ClassroomImportItem,
    calendar_items_from_events,
    classroom_items_from_coursework,
    external_item_id,
    pkce_challenge,
    with_course_names,
)
from studyflow.tasks.service import TaskCategory

NOW = datetime(2026, 9, 18, 8, tzinfo=UTC)


def event(event_id: str, **fields: object) -> dict[str, Any]:
    return {
        "id": event_id,
        "status": "confirmed",
        "summary": f"Event {event_id}",
        "start": {"dateTime": "2026-09-20T09:00:00+07:00"},
        "end": {"dateTime": "2026-09-20T11:00:00+07:00"},
        **fields,
    }


def test_pkce_challenge_matches_the_rfc_7636_example() -> None:
    assert (
        pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )


def test_external_item_ids_are_fixed_length_and_do_not_reveal_google_ids() -> None:
    item_id = external_item_id("primary", "secret-event-id")

    assert len(item_id) == 64
    assert "secret" not in item_id
    assert item_id == external_item_id("primary", "secret-event-id")
    assert item_id != external_item_id("primary", "other-event-id")


def test_calendar_import_keeps_only_future_busy_events() -> None:
    events: list[dict[str, Any]] = [
        event("busy"),
        event("cancelled", status="cancelled"),
        event("free", transparency="transparent"),
        event("working", eventType="workingLocation"),
        event("birthday", eventType="birthday"),
        event("declined", attendees=[{"self": True, "responseStatus": "declined"}]),
        event("accepted", attendees=[{"self": True, "responseStatus": "accepted"}]),
        event(
            "past",
            start={"dateTime": "2026-09-17T09:00:00Z"},
            end={"dateTime": "2026-09-17T10:00:00Z"},
        ),
        event("reversed", end={"dateTime": "2026-09-20T08:00:00+07:00"}),
        event("naive", start={"dateTime": "2026-09-20T09:00:00"}),
        event("no-bounds", start="not an object"),
        {"summary": "missing id"},
    ]

    items = calendar_items_from_events(events, "Asia/Phnom_Penh", NOW)

    assert [item.title for item in items] == ["Event busy", "Event accepted"]
    assert items[0].starts_at == datetime(2026, 9, 20, 2, tzinfo=UTC)
    assert items[0].ends_at == datetime(2026, 9, 20, 4, tzinfo=UTC)
    assert items[0].all_day is False


def test_calendar_all_day_events_cover_whole_local_days() -> None:
    items = calendar_items_from_events(
        [event("trip", start={"date": "2026-09-21"}, end={"date": "2026-09-23"}, summary=None)],
        "Asia/Phnom_Penh",
        NOW,
    )

    assert len(items) == 1
    assert items[0].all_day is True
    assert items[0].title == "Busy"
    assert items[0].starts_at == datetime(2026, 9, 20, 17, tzinfo=UTC)
    assert items[0].ends_at == datetime(2026, 9, 22, 17, tzinfo=UTC)


def test_calendar_titles_are_single_line_and_fit_the_reason_limit() -> None:
    items = calendar_items_from_events(
        [event("long", summary="Line one\n\tline two " + "x" * 400)], "UTC", NOW
    )

    assert items[0].title.startswith("Line one line two x")
    assert len(items[0].title) == 200


def test_calendar_items_round_trip_through_snapshot_json() -> None:
    item = calendar_items_from_events([event("busy")], "UTC", NOW)[0]

    assert CalendarImportItem.from_json(item.to_json()) == item


def coursework(work_id: str, **fields: object) -> dict[str, Any]:
    return {
        "id": work_id,
        "courseId": "course-1",
        "courseName": "Data Structures",
        "title": f"Assignment {work_id}",
        "dueDate": {"year": 2026, "month": 9, "day": 25},
        "dueTime": {"hours": 16, "minutes": 30},
        "alternateLink": f"https://classroom.google.com/c/abc/a/{work_id}/details",
        **fields,
    }


def test_classroom_import_keeps_unfinished_coursework_with_a_future_due_date() -> None:
    works: list[dict[str, Any]] = [
        coursework("open"),
        coursework("turned-in", submissionState="TURNED_IN"),
        coursework("returned", submissionState="RETURNED"),
        coursework("created", submissionState="CREATED"),
        coursework("no-due-date", dueDate=None),
        coursework("bad-date", dueDate={"year": 2026, "month": 13, "day": 1}),
        coursework("past", dueDate={"year": 2026, "month": 9, "day": 1}),
        coursework("untitled", title="   "),
        {"id": "missing-course"},
    ]

    items = classroom_items_from_coursework(works, "Asia/Phnom_Penh", NOW)

    # Ordered by due date, then title.
    assert [item.title for item in items] == ["Assignment created", "Assignment open"]
    assert items[1].due_at == datetime(2026, 9, 25, 16, 30, tzinfo=UTC)
    assert items[1].course == "Data Structures"
    assert items[1].link == "https://classroom.google.com/c/abc/a/open/details"


def test_classroom_due_dates_without_a_time_end_the_local_day() -> None:
    items = classroom_items_from_coursework(
        [coursework("date-only", dueTime=None), coursework("midnight", dueTime={})],
        "Asia/Phnom_Penh",
        NOW,
    )

    due = {item.title: item.due_at for item in items}
    assert due["Assignment date-only"] == datetime(2026, 9, 25, 16, 59, tzinfo=UTC)
    assert due["Assignment midnight"] == datetime(2026, 9, 25, 0, 0, tzinfo=UTC)


def test_classroom_links_must_point_to_google_classroom() -> None:
    items = classroom_items_from_coursework(
        [
            coursework("phishing", alternateLink="https://example.com/classroom"),
            coursework("script", alternateLink="javascript:alert(1)"),
        ],
        "UTC",
        NOW,
    )

    assert [item.link for item in items] == [None, None]


def test_classroom_suggests_exam_preparation_for_exam_like_titles() -> None:
    items = classroom_items_from_coursework(
        [coursework("quiz", title="Week 3 Quiz"), coursework("essay", title="Essay draft")],
        "UTC",
        NOW,
    )

    categories = {item.title: item.suggested_category for item in items}
    assert categories == {
        "Week 3 Quiz": TaskCategory.EXAM_PREPARATION,
        "Essay draft": TaskCategory.ASSIGNMENT,
    }
    assert ClassroomImportItem.from_json(items[0].to_json()) == items[0]


def test_course_names_are_attached_by_course_id() -> None:
    assert with_course_names([{"courseId": "c1"}, {"courseId": "c2"}], {"c1": "Physics"}) == [
        {"courseId": "c1", "courseName": "Physics"},
        {"courseId": "c2", "courseName": None},
    ]
