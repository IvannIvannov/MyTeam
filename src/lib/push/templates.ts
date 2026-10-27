import type {
  NotificationTemplateInput,
  PushNotificationPayload,
} from "@/lib/push/types";

const DEFAULT_ICON = "/myteam-logo.webp";
const DEFAULT_URL = "/";

export function buildNotificationPayload(
  input: NotificationTemplateInput
): PushNotificationPayload {
  const memberPrefix = input.memberName ? `${input.memberName}: ` : "";
  const remainingVisits =
    typeof input.remainingVisits === "number" ? Math.max(input.remainingVisits, 0) : undefined;
  const url = input.url ?? DEFAULT_URL;

  switch (input.type) {
    case "visit_registered":
      return {
        title: "Посещението е отчетено",
        body:
          remainingVisits === undefined
            ? `${memberPrefix}Чекирането е успешно.`
            : `${memberPrefix}Чекирането е успешно. Остават ${remainingVisits} посещения.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "visit-registered",
        data: { type: input.type },
      };
    case "membership_almost_finished":
      return {
        title: "Картата е почти изчерпана",
        body:
          remainingVisits === undefined
            ? `${memberPrefix}Остават малко посещения.`
            : `${memberPrefix}Остават само ${remainingVisits} посещения.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "membership-almost-finished",
        data: { type: input.type, remainingVisits },
      };
    case "training_reminder": {
      const suffix = input.trainingDate ? ` (${input.trainingDate})` : "";
      return {
        title: "Напомняне за тренировка",
        body: `${memberPrefix}Имаш предстояща тренировка${suffix}.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "training-reminder",
        data: { type: input.type, trainingDate: input.trainingDate ?? null },
      };
    }
    case "trainer_message":
      return {
        title: "Съобщение",
        body:
          input.trainerMessage?.trim() ||
          `${memberPrefix}Имате ново съобщение.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "trainer-message",
        data: { type: input.type },
      };
    case "monthly_membership_payment_reminder":
      return {
        title: "Напомняне",
        body:
          "Напомняне: Здравейте! Напомняме Ви, че предстои плащането на месечния Ви членски внос.",
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "monthly-membership-payment-reminder",
        data: { type: input.type },
      };
    case "myteam_message":
    case "admin_message":
      return {
        title: "Съобщение от администратора на MyTeam",
        body: input.trainerMessage?.trim() || "Имате ново съобщение.",
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "admin-message",
        data: { type: input.type },
      };
    case "member_push_enabled":
      return {
        title: "Известия са активирани",
        body: memberPrefix
          ? `${memberPrefix}Включи известия на телефона (PWA).`
          : "Състезател включи известия на телефона (PWA).",
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "member-push-enabled",
        data: { type: input.type },
      };
    case "monthly_overdue_payment_reminder":
      return {
        title: "Просрочие",
        body:
          "Просрочие: Здравейте! Вие просрочихте плащането и вече дължите два месечни членски вноса!",
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "monthly-overdue-payment-reminder",
        data: { type: input.type },
      };
    case "limited_training_promoted": {
      const suffix = input.trainingDate ? ` на ${input.trainingDate}` : "";
      return {
        title: "Записан за тренировка!",
        body: `Освободи се място и вече си записан за тренировката${suffix}.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "limited-training-promoted",
        data: { type: input.type, trainingDate: input.trainingDate ?? null },
      };
    }
    case "limited_training_waitlisted": {
      const suffix = input.trainingDate ? ` на ${input.trainingDate}` : "";
      return {
        title: "Преместен в чакащ списък",
        body: `Местата за тренировката${suffix} бяха намалени. Вие сте в чакащия списък.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "limited-training-waitlisted",
        data: { type: input.type, trainingDate: input.trainingDate ?? null },
      };
    }
    case "limited_training_created": {
      const suffix = input.trainingDate ? ` на ${input.trainingDate}` : "";
      const spotsText = typeof input.maxSpots === "number" ? ` (${input.maxSpots} места)` : "";
      return {
        title: "Записване за тренировка",
        body: `Тренировката${suffix}${spotsText} е с ограничен брой места. Запишете се навреме!`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "limited-training-created",
        data: { type: input.type, trainingDate: input.trainingDate ?? null },
      };
    }
    case "training_cancelled": {
      const suffix = input.trainingDate ? ` на ${input.trainingDate}` : "";
      return {
        title: "Тренировката е отменена",
        body: `Тренировката${suffix} е отменена.`,
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "training-cancelled",
        data: { type: input.type, trainingDate: input.trainingDate ?? null },
      };
    }
    case "birthday":
      return {
        title: "🎂 Честит рожден ден!",
        body: input.memberName
          ? `${input.memberName}, денят ти е специален! Виж поздравлението си.`
          : "Денят ти е специален! Виж поздравлението си.",
        url: input.cardCode ? `/member/${input.cardCode}` : url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: "birthday",
        data: { type: input.type },
      };
    default:
      return {
        title: "Ново известие",
        body: "Имате ново известие.",
        url,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
      };
  }
}
