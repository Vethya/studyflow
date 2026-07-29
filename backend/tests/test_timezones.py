from studyflow.timezones import is_iana_timezone


def test_timezone_validation_accepts_portable_iana_keys_only() -> None:
    assert is_iana_timezone("Asia/Phnom_Penh")
    assert is_iana_timezone("UTC")
    assert not is_iana_timezone("posixrules")
    assert not is_iana_timezone("not/a-timezone")
