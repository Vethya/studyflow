import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — StudyFlow",
  description: "The terms for using StudyFlow, the student study planner.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms apply when you create a StudyFlow account or use the app. StudyFlow is a study planner built as a university thesis project, so please read the section on availability too."
    >
      <LegalSection title="Your account">
        <ul>
          <li>Use a real email address you can access, and keep your password private.</li>
          <li>You are responsible for what happens under your account.</li>
          <li>One account per person. Accounts are for individual students, not shared use.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Using StudyFlow">
        <p>You agree not to:</p>
        <ul>
          <li>Try to access another student&apos;s account or data.</li>
          <li>Attack, overload, or probe the service for weaknesses without permission.</li>
          <li>Use automated scripts to create accounts or send large numbers of requests.</li>
          <li>Store unlawful content or confidential material that is not yours to share.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Plans and pricing">
        <p>
          The Free plan includes the full planner at no cost. A paid Pro plan is shown on
          our home page as coming soon. It is not available to buy yet, and you will never
          be charged without choosing a paid plan and agreeing to its price first.
        </p>
      </LegalSection>

      <LegalSection title="Planning advice, not a guarantee">
        <p>
          StudyFlow schedules and overload warnings are based on the estimates and
          availability you enter. They help you plan, but they cannot guarantee that work
          will be finished on time or meet your course requirements. Always check official
          deadlines with your institution.
        </p>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          StudyFlow is a thesis project running on free hosting. It may be slow to start
          after a period of inactivity, may be unavailable at times, and may change or end
          when the project finishes. Keep your own record of important deadlines.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          The tasks and notes you add stay yours. You let us store and process them only to
          run StudyFlow for you and to evaluate the thesis, as described in the{" "}
          <Link href="/privacy" className="underline underline-offset-4">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Ending your account">
        <p>
          You can delete your account at any time from Settings, which permanently removes
          your data. We may suspend an account that breaks these terms.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          StudyFlow is provided &ldquo;as is&rdquo;, without warranties. To the extent the
          law allows, the project team is not liable for missed deadlines, lost data, or
          other losses from using the service.
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          If these terms change, we will update the date at the top of this page. Continuing
          to use StudyFlow after a change means you accept the updated terms.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
