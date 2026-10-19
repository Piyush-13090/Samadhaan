import { redirect } from 'next/navigation';

/**
 * Settings (Prompt 30).
 *
 * The earlier settings screen was a design mock: its save button only showed a
 * success toast and its notification switches were wired to nothing. Account
 * details are edited on the profile page, which persists them, so this route
 * sends people there instead of pretending to save.
 */
export default function SettingsPage(): never {
  redirect('/profile');
}
