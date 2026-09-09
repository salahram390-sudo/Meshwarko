const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

exports.notifyDriversOnNewRide = onDocumentCreated(
  {
    document: "rides/{rideId}",
    region: "europe-west1",
    maxInstances: 5,
  },
  async (event) => {
    const snap = event.data;

    if (!snap) {
      logger.warn("No ride snapshot received");
      return;
    }

    const ride = snap.data() || {};
    const rideId = event.params.rideId;

    // نرسل فقط عند إنشاء طلب جديد
    if (ride.status !== "requested" || ride.archived === true) {
      logger.info("Skipping ride notification", {
        rideId,
        status: ride.status,
      });
      return;
    }

    // السائقون الأقرب الذين حددهم التطبيق
    let driverIds = Array.isArray(ride.nearestDriverIds)
      ? ride.nearestDriverIds.filter(Boolean)
      : [];

    // احتياطًا لو nearestDriverIds غير موجود
    if (!driverIds.length && Array.isArray(ride.nearestDrivers)) {
      driverIds = ride.nearestDrivers
        .map((driver) => driver?.uid || driver?.id)
        .filter(Boolean);
    }

    driverIds = [...new Set(driverIds)].slice(0, 50);

    if (!driverIds.length) {
      logger.info("No nearby drivers attached to ride", { rideId });
      return;
    }

    // جلب بيانات السائقين
    const userSnaps = await Promise.all(
      driverIds.map((uid) =>
        db.collection("users").doc(uid).get()
      )
    );

    const tokenMap = new Map();

    userSnaps.forEach((userSnap, index) => {
      if (!userSnap.exists) return;

      const user = userSnap.data() || {};

      // نتأكد أنه سائق وليس محظورًا
      if (user.role !== "driver" || user.status === "blocked") {
        return;
      }

      const token =
        typeof user.fcmToken === "string"
          ? user.fcmToken.trim()
          : "";

      if (!token) return;

      if (!tokenMap.has(token)) {
        tokenMap.set(token, driverIds[index]);
      }
    });

    const finalTokens = [...tokenMap.keys()].slice(0, 500);

    if (!finalTokens.length) {
      logger.info("No driver FCM tokens available", {
        rideId,
        driverIds,
      });
      return;
    }

    const title = "🚕 طلب مشوار جديد";

    const body =
      ride.pickupText && ride.dropoffText
        ? `${ride.pickupText} ← ${ride.dropoffText}`
        : "لديك طلب رحلة جديد قريب منك";

    const message = {
      tokens: finalTokens,

      notification: {
        title,
        body,
      },

      data: {
        type: "new_ride_request",
        rideId: String(rideId),
        title,
        body,
        status: String(ride.status || "requested"),
        pickupText: String(ride.pickupText || ""),
        dropoffText: String(ride.dropoffText || ""),
        governorate: String(ride.governorate || ""),
        center: String(ride.center || ""),
        clickUrl: "./driver.html",
      },
    };

    const response = await messaging.sendEachForMulticast(message);

    logger.info("New ride push sent", {
      rideId,
      requestedDrivers: driverIds.length,
      tokens: finalTokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    // تنظيف الـ tokens القديمة/غير الصالحة
    const invalidTokens = [];

    response.responses.forEach((result, index) => {
      if (result.success) return;

      const code = result.error?.code || "";

      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        invalidTokens.push(finalTokens[index]);
      }
    });

    if (invalidTokens.length) {
      const batch = db.batch();

      userSnaps.forEach((userSnap) => {
        if (!userSnap.exists) return;

        const user = userSnap.data() || {};
        const token = user.fcmToken;

        if (invalidTokens.includes(token)) {
          batch.update(userSnap.ref, {
            fcmToken: null,
            fcmUpdatedAt: null,
          });
        }
      });

      await batch.commit();
    }
  }
);
