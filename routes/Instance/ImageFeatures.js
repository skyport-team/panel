const express = require("express");
const router = express.Router();
const { db } = require("../../handlers/db.js");
const {
  isUserAuthorizedForContainer,
  isInstanceSuspended,
} = require("../../utils/authHelper");
const { createFile, editFile } = require("../../utils/fileHelper");
const log = new (require("cat-loggr"))();

router.post("/instance/:id/imagefeatures/eula", async (req, res) => {
  if (!req.user) return res.redirect("/");

  const { id } = req.params;

  const instance = await db.get(id + "_instance").catch((err) => {
    log.error("Failed to fetch instance:", err);
    return null;
  });

  if (!instance || !instance.VolumeId) return res.redirect("../instances");

  const isAuthorized = await isUserAuthorizedForContainer(
    req.user.userId,
    instance.Id
  );
  if (!isAuthorized) {
    return res.status(403).send("Unauthorized access to this instance.");
  }

  const suspended = await isInstanceSuspended(req.user.userId, instance, id);
  if (suspended === true) {
    return res.render("instance/suspended", { req, user: req.user });
  }

  try {
    await createFile(instance, "eula.txt", "eula=true");
    await editFile(instance, "eula.txt", "eula=true");
  } catch (error) {
    log.error(`Failed to update eula.txt for instance ${id}:`, error);
    return res.status(500).send("Error updating EULA file");
  }

  res.status(200);
});

module.exports = router;
