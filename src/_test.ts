import { db, getGameMetadata } from "./db";

async function checkVersions() {
  //
  let lastEngineVersion = await db
    .collection("engine-versions")
    .where("commit.branch", "==", "main")
    .orderBy("timestamp", "desc")
    .limit(2)
    .get();

  let lastEngineVersionData = lastEngineVersion.docs.map((doc) => {
    //
    let c = doc.data().commit;

    return {
      sha: doc.id,
      timestamp: new Date(doc.data().timestamp),
      committedAt: c.committedAt,
    };
  });

  console.log("lastEngineVersionData", lastEngineVersionData);
}

checkVersions();
