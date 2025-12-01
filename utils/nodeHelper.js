/**
 * Centralized Node operations helper
 * Replaces the duplicate checkNodeStatus functions across the codebase
 */

const axios = require("axios");
const { db } = require("../handlers/db.js");
const cache = require("./cache.js");
const log = new (require("cat-loggr"))();

/**
 * Check the operational status of a node via HTTP request
 * Includes built-in caching to avoid repeated network calls
 * 
 * @param {Object} node - Node object with address, port, apiKey, id
 * @param {boolean} skipCache - Force refresh even if cached (default: false)
 * @returns {Promise<Object>} Updated node object with status
 */
async function checkNodeStatus(node, skipCache = false) {
  if (!node || !node.id) {
    throw new Error("Invalid node object");
  }

  const cacheKey = `node_status_${node.id}`;

  // Return cached result if available and not skipped
  if (!skipCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const requestData = {
      method: "get",
      url: `http://${node.address}:${node.port}/`,
      auth: {
        username: "Skyport",
        password: node.apiKey,
      },
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 5000, // 5 second timeout
    };

    const response = await axios(requestData);

    if (
      response.data &&
      response.data.versionFamily &&
      response.data.versionRelease
    ) {
      const { versionFamily, versionRelease, online, remote, docker } =
        response.data;

      node.status = online ? "Online" : "Offline";
      node.versionFamily = versionFamily;
      node.versionRelease = versionRelease;
      node.remote = remote;
      if (docker) {
        node.docker = docker;
      }

      // Update database
      await db.set(`${node.id}_node`, node);

      // Cache the result (2 minute TTL for status checks)
      cache.set(cacheKey, node, 2 * 60 * 1000);

      return node;
    } else {
      throw new Error("Invalid response structure from node API");
    }
  } catch (error) {
    log.error(`Error checking status for node ${node.id}: ${error.message}`);

    node.status = "Offline";
    await db.set(`${node.id}_node`, node);

    // Cache offline status too (1 minute TTL)
    cache.set(cacheKey, node, 60 * 1000);

    return node;
  }
}

/**
 * Check status for multiple nodes in parallel with batching
 * Uses Promise.all for efficient concurrent operations
 * 
 * @param {Array<string>} nodeIds - Array of node IDs to check
 * @param {boolean} skipCache - Force refresh (default: false)
 * @returns {Promise<Array<Object>>} Array of updated node objects
 */
async function checkMultipleNodesStatus(nodeIds, skipCache = false) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return [];
  }

  try {
    const nodePromises = nodeIds.map((id) =>
      db.get(id + "_node").then((node) => {
        if (node) {
          return checkNodeStatus(node, skipCache);
        }
        return null;
      })
    );

    const nodes = await Promise.all(nodePromises);
    return nodes.filter((node) => node !== null);
  } catch (error) {
    log.error(`Error checking multiple nodes status: ${error.message}`);
    return [];
  }
}

/**
 * Invalidate cache for a specific node
 * @param {string} nodeId - Node ID to clear cache for
 */
function invalidateNodeCache(nodeId) {
  cache.delete(`node_status_${nodeId}`);
}

/**
 * Invalidate cache for all nodes
 */
function invalidateAllNodeCache() {
  const stats = cache.stats();
  stats.keys.forEach((key) => {
    if (key.startsWith("node_status_")) {
      cache.delete(key);
    }
  });
}

module.exports = {
  checkNodeStatus,
  checkMultipleNodesStatus,
  invalidateNodeCache,
  invalidateAllNodeCache,
};
