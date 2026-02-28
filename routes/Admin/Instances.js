const express = require("express");
const router = express.Router();
const axios = require("axios");
const { db } = require("../../handlers/db.js");
const { logAudit } = require("../../handlers/auditLog.js");
const { isAdmin } = require("../../utils/isAdmin.js");
const { checkMultipleNodesStatus, invalidateNodeCache } = require("../../utils/nodeHelper.js");
const { getPaginatedInstances, invalidateCache, invalidateCacheGroup } = require("../../utils/dbHelper.js");
const fs = require("fs");
const path = require("path");
const log = new (require("cat-loggr"))();

const workflowsFilePath = path.join(__dirname, "../../storage/workflows.json");

async function deleteInstance(instance) {
  try {
    const requestData = {
      method: "delete",
      url: `http://${instance.Node.address}:${instance.Node.port}/instances/${instance.ContainerId}`,
      auth: {
        username: "Skyport",
        password: instance.Node.apiKey,
      },
      headers: {
        "Content-Type": "application/json",
      },
    };

    await axios(requestData);
  } catch (error) {
    log.warn(`Docker delete failed for ${instance.Id} (container may already be removed): ${error.message}`);
  }

  try {
    let userInstances = (await db.get(instance.User + "_instances")) || [];
    userInstances = userInstances.filter((obj) => obj.Id !== instance.Id);
    await db.set(instance.User + "_instances", userInstances);

    let globalInstances = (await db.get("instances")) || [];
    globalInstances = globalInstances.filter((obj) => obj.Id !== instance.Id);
    await db.set("instances", globalInstances);

    await db.delete(instance.Id + "_instance");

    await db.delete(instance.Id + "_workflow");
    await deleteWorkflowFromFile(instance.Id);

    // Invalidate cache after deletion
    invalidateCache("instances");
    invalidateCache(instance.User + "_instances");
  } catch (error) {
    log.error(`Error cleaning up database for instance ${instance.Id}:`, error);
    throw error;
  }
}

function deleteWorkflowFromFile(instanceId) {
  try {
    if (fs.existsSync(workflowsFilePath)) {
      const data = fs.readFileSync(workflowsFilePath, "utf8");
      const workflows = JSON.parse(data);

      if (workflows[instanceId]) {
        delete workflows[instanceId];
        fs.writeFileSync(
          workflowsFilePath,
          JSON.stringify(workflows, null, 2),
          "utf8"
        );
      }
    } else {
      console.error("Workflows file does not exist.");
    }
  } catch (error) {
    console.error("Error deleting workflow from file:", error);
  }
}

router.get("/admin/instances", isAdmin, async (req, res) => {
  const page = req.query.page ? parseInt(req.query.page) : 1;
  const pageSize = req.query.pageSize ? parseInt(req.query.pageSize) : 20;

  // Use pagination for instances
  const instancesResult = await getPaginatedInstances(page, pageSize);
  
  let images = (await db.get("images")) || [];
  let nodes = (await db.get("nodes")) || [];
  let users = (await db.get("users")) || [];

  // Use optimized batch operation for node status checks
  nodes = await checkMultipleNodesStatus(nodes);

  res.render("admin/instances", {
    req,
    user: req.user,
    instances: instancesResult.data,
    pagination: instancesResult.pagination,
    images,
    nodes,
    users,
  });
});

router.get("/admin/instances/:id/edit", isAdmin, async (req, res) => {
  const { id } = req.params;
  const instance = await db.get(id + "_instance");
  let users = (await db.get("users")) || [];
  let images = (await db.get("images")) || [];

  if (!instance) return res.redirect("/admin/instances");
  res.render("admin/instance_edit", {
    req,
    user: req.user,
    instance,
    images,
    users,
  });
});

router.get("/admin/instance/delete/:id", isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.redirect("/admin/instances");
    }

    const instance = await db.get(id + "_instance");
    if (!instance) {
      return res.status(404).send("Instance not found");
    }

    await deleteInstance(instance);
    logAudit(req.user.userId, req.user.username, "instance:delete", req.ip);
    res.redirect("/admin/instances");
  } catch (error) {
    log.error("Error in delete instance endpoint:", error);
    res.status(500).send("An error occurred while deleting the instance");
  }
});

router.get("/admin/instances/purge/all", isAdmin, async (req, res) => {
  try {
    const instances = (await db.get("instances")) || [];

    for (const instance of instances) {
      await deleteInstance(instance);
    }

    await db.delete("instances");
    res.redirect("/admin/instances");
  } catch (error) {
    log.error("Error in purge all instances endpoint:", error);
    res.status(500).send("An error occurred while purging all instances");
  }
});

router.post("/admin/instances/suspend/:id", isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.redirect("/admin/instances");
    }
    const instance = await db.get(id + "_instance");
    if (!instance) {
      return res.status(404).send("Instance not found");
    }

    instance.suspended = true;
    await db.set(id + "_instance", instance);
    let instances = (await db.get("instances")) || [];

    let instanceToSuspend = instances.find(
      (obj) => obj.ContainerId === instance.ContainerId
    );
    if (instanceToSuspend) {
      instanceToSuspend.suspended = true;
    }

    await db.set("instances", instances);

    // Invalidate cache after update
    invalidateCache("instances");
    invalidateCache(id + "_instance");

    logAudit(req.user.userId, req.user.username, "instance:suspend", req.ip);
    res.redirect("/admin/instances");
  } catch (error) {
    log.error("Error in suspend instance endpoint:", error);
    res.status(500).send("An error occurred while suspending the instance");
  }
});

router.post("/admin/instances/unsuspend/:id", isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (!id) {
      return res.redirect("/admin/instances");
    }
    const instance = await db.get(id + "_instance");
    if (!instance) {
      return res.status(404).send("Instance not found");
    }

    instance.suspended = false;

    await db.set(id + "_instance", instance);

    let instances = (await db.get("instances")) || [];

    let instanceToUnsuspend = instances.find(
      (obj) => obj.ContainerId === instance.ContainerId
    );
    if (instanceToUnsuspend) {
      instanceToUnsuspend.suspended = false;
    }
    if (instanceToUnsuspend["suspended-flagg"]) {
      delete instanceToUnsuspend["suspended-flagg"];
    }

    await db.set("instances", instances);

    // Invalidate cache after update
    invalidateCache("instances");
    invalidateCache(id + "_instance");

    logAudit(req.user.userId, req.user.username, "instance:unsuspend", req.ip);

    res.redirect("/admin/instances");
  } catch (error) {
    log.error("Error in unsuspend instance endpoint:", error);
    res.status(500).send("An error occurred while unsuspending the instance");
  }
});

module.exports = router;
