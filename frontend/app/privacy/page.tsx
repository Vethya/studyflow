import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — StudyFlow",
  description: "What StudyFlow collects, why, how long it is kept, and how to delete it.",
};

// Kept in step with docs/data-inventory.md (NFR-06). Update both together.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="StudyFlow is a student study planner built as a thesis project. We collect only what is needed to sign you in, plan your study time, keep the service secure, and evaluate the thesis. This page explains what that is and what you can do about it."
    >
      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your email address, name, timezone and
            planning preferences such as session length and break length. If you sign in
            with Google, we store your Google account identifier and verified email.
          </li>
          <li>
            <strong>Planning data you enter:</strong> tasks, categories, priorities,
            deadlines, time estimates, optional course names and notes, your weekly
            availability, and blocked periods.
          </li>
          <li>
            <strong>Study history:</strong> generated schedules, study sessions, and what
            you record about them (completed, delayed or missed, and how long the work
            actually took). This is used to show your progress and improve estimates.
          </li>
          <li>
            <strong>Security data:</strong> session and one-time link records, stored only
            as one-way hashes, and short-lived rate-limit counters.
          </li>
        </ul>
        <p>
          Please do not put confidential academic content in task titles or notes. StudyFlow
          does not need it.
        </p>
      </LegalSection>

      <LegalSection title="What we do not collect">
        <ul>
          <li>Your raw password. It is hashed with Argon2id before it is stored.</li>
          <li>Your IP address. Only a one-way hash is kept, for the length of a rate-limit window.</li>
          <li>Advertising trackers, analytics profiles, or device fingerprints.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>To sign you in and keep your account secure.</li>
          <li>To build your study schedule, warn you about overload, and track effort progress.</li>
          <li>To adjust time estimates from the tasks you have already finished.</li>
          <li>To send sign-up verification and password-reset emails.</li>
          <li>
            To measure how well StudyFlow works for the thesis. Evaluation exports use
            pseudonymous codes and leave out your email, name, password, task titles,
            courses and notes.
          </li>
        </ul>
        <p>We do not sell your data or use it for advertising.</p>
      </LegalSection>

      <LegalSection title="Who else receives it">
        <ul>
          <li>
            <strong>Email delivery:</strong> our email provider receives your address and the
            one-time link needed to deliver verification and recovery emails.
          </li>
          <li>
            <strong>Google:</strong> only if you choose to sign in with Google.
          </li>
          <li>
            <strong>Hosting:</strong> the app and database run on third-party cloud hosting
            providers that store the data on our behalf.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies and browser storage">
        <p>
          StudyFlow uses only the cookies it needs to work: a sign-in session cookie (up to
          seven days), a security (CSRF) cookie, and short-lived cookies for Google sign-in.
          Your browser also stores small settings, such as your chosen theme. There are no
          advertising or tracking cookies.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <ul>
          <li>Account and planning data: until you delete it or delete your account.</li>
          <li>Sign-in sessions: until you sign out or they expire.</li>
          <li>Verification and reset links: until they are used or expire.</li>
          <li>Thesis evaluation exports: only for the approved analysis period, then deleted.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Your choices">
        <ul>
          <li>Edit your name and planning preferences at any time in Settings.</li>
          <li>
            Delete any task. Its sessions, outcomes and estimate history are deleted with it,
            and your estimates are recalculated without it.
          </li>
          <li>
            Delete your account from{" "}
            <Link href="/settings" className="underline underline-offset-4">Settings</Link>.
            This permanently removes your account and all of your planning data.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If this policy changes, we will update the date at the top of this page. For
          questions about your data, contact the StudyFlow project team.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
