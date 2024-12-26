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

export async function getGameMetadata(gameId: string) {
  //
  const doc = await db.collection("games").doc(gameId).get();
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    headline: data?.headline?.replace("Untitled", "Draft"),
    createdAt: data.createdAt?.toDate?.(),
    updatedAt: data.updatedAt?.toDate?.(),
  };
}
