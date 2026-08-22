export interface StudentAccount {
  id: string;
  name: string;
  email: string;
  isEmailVerified: boolean;
  hasGoogleLinked: boolean;
  timezone: string; // IANA timezone
  preferredSessionLength: number; // 10-240 minutes, default 60
  minimumBreak: number; // 0-120 minutes, default 10
  avatarUrl?: string;
  createdAt: string;
}

export interface AccountSettings {
  name: string;
  timezone: string;
  preferredSessionLength: number;
  minimumBreak: number;
}

export interface PasswordChangeData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
