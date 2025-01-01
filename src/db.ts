import "dotenv/config";
import admin from "firebase-admin";
import { ENV } from "./env";

const credentials = {
  projectId: ENV.FIREBASE_ADMIN_PROJECT_ID,
  privateKey: ENV.FIREBASE_ADMIN_PRIVATE_KEY,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
};

let app = admin.initializeApp({
  credential: admin.credential.cert(credentials),
  storageBucket: `${process.env.FIREBASE_ADMIN_PROJECT_ID}-engine`,
});

app.firestore().settings({ ignoreUndefinedProperties: true });

export const db = app.firestore();

const gameMetadataReqs: Record<string, Promise<any>> = {};

const DB_CACHE_TTL = 5000;

export class DbService {
  //
  static async getGameMetadata(gameId: string) {
    //
    if (gameMetadataReqs[gameId]) {
      return gameMetadataReqs[gameId];
    }

    const promise = db
      .collection("games")
      .doc(gameId)
      .get()
      .then((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          headline: data?.headline?.replace("Untitled", "Draft"),
          createdAt: data.createdAt?.toDate?.(),
          updatedAt: data.updatedAt?.toDate?.(),
        };
      });

    promise.finally(() => {
      setTimeout(() => {
        delete gameMetadataReqs[gameId];
      }, DB_CACHE_TTL);
    });

    gameMetadataReqs[gameId] = promise;

    return promise;
  }

  static async logEvent(event: any) {
    //
    await db.collection("events").add({
      ...event,
      server_ts: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}
