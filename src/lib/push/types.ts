export type NotificationTemplateType =
  | "visit_registered"
  | "membership_almost_finished"
  | "training_reminder"
  | "match_schedule"
  | "trainer_message"
  | "monthly_membership_payment_reminder"
  | "monthly_overdue_payment_reminder"
  | "admin_message"
  | "myteam_message"
  | "member_push_enabled"
  | "limited_training_created"
  | "limited_training_promoted"
  | "limited_training_waitlisted"
  | "training_cancelled"
  | "birthday";

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationTemplateInput {
  type: NotificationTemplateType;
  memberName?: string;
  remainingVisits?: number;
  trainingDate?: string;
  trainerMessage?: string;
  url?: string;
  maxSpots?: number;
  cardCode?: string;
}
