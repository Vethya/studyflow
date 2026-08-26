import { redirect } from "next/navigation";

/**
 * Landing spot for a successful Google sign-in: the backend's browser flow
 * redirects to `/app` after setting the session cookies. The real home is the
 * dashboard, so hand straight over.
 */
export default function GoogleSignInLanding() {
  redirect("/dashboard");
}
