const express = require("express");
const router = express.Router();
const { db } = require("../../handlers/db.js");
const config = require("../../config.json");
const { isAdmin } = require("../../utils/isAdmin.js");
const { batchGet } = require("../../utils/dbHelper.js");

router.get("/admin/overview", isAdmin, async (req, res) => {
  try {
    // Use batch operations to fetch all required data in parallel
    const [users, nodesIds, images, instances] = await Promise.all([
      db.get("users").then(data => data || []),
      db.get("nodes").then(data => data || []),
      db.get("images").then(data => data || []),
      db.get("instances").then(data => data || [])
    ]);

    // Calculate the total number of each type of object
    const usersTotal = users.length;
    const nodesTotal = nodesIds.length;
    const imagesTotal = images.length;
    const instancesTotal = instances.length;

    res.render("admin/overview", {
      req,
      user: req.user,
      usersTotal,
      nodesTotal,
      imagesTotal,
      instancesTotal,
      version: config.version,
    });
  } catch (error) {
    res
      .status(500)
      .send({ error: "Failed to retrieve data from the database." });
  }
});

module.exports = router;
