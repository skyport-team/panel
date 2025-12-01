/**
 * Database helper utilities for optimized queries
 * Provides batch operations, pagination, and caching
 */

const { db } = require("../handlers/db.js");
const cache = require("./cache.js");

/**
 * Get multiple records from database in batch
 * More efficient than individual db.get calls
 * 
 * @param {Array<string>} keys - Array of database keys
 * @param {boolean} useCache - Use cache for results (default: true)
 * @returns {Promise<Array>} Array of database records
 */
async function batchGet(keys, useCache = true) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return [];
  }

  const results = [];
  const keysToFetch = [];

  // Check cache first if enabled
  if (useCache) {
    for (const key of keys) {
      const cacheKey = `db_${key}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        results.push(cached);
      } else {
        keysToFetch.push(key);
      }
    }
  } else {
    keysToFetch.push(...keys);
  }

  // Fetch remaining keys from database
  if (keysToFetch.length > 0) {
    const fetchedResults = await Promise.all(
      keysToFetch.map((key) => db.get(key))
    );

    // Cache and collect results
    for (let i = 0; i < keysToFetch.length; i++) {
      const key = keysToFetch[i];
      const value = fetchedResults[i];
      if (value !== undefined) {
        cache.set(`db_${key}`, value, 5 * 60 * 1000); // 5 minute TTL
        results.push(value);
      }
    }
  }

  return results;
}

/**
 * Paginate an array of results
 * 
 * @param {Array} items - Array to paginate
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Items per page
 * @returns {Object} Pagination object with data and metadata
 */
function paginate(items, page = 1, pageSize = 20) {
  if (!Array.isArray(items)) {
    items = [];
  }

  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages || 1));

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const data = items.slice(startIndex, endIndex);

  return {
    data,
    pagination: {
      currentPage,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
    },
  };
}

/**
 * Get paginated list of users
 * 
 * @param {number} page - Page number
 * @param {number} pageSize - Items per page
 * @returns {Promise<Object>} Paginated users with metadata
 */
async function getPaginatedUsers(page = 1, pageSize = 20) {
  const users = (await db.get("users")) || [];
  return paginate(users, page, pageSize);
}

/**
 * Get paginated list of instances
 * 
 * @param {number} page - Page number
 * @param {number} pageSize - Items per page
 * @returns {Promise<Object>} Paginated instances with metadata
 */
async function getPaginatedInstances(page = 1, pageSize = 20) {
  const instances = (await db.get("instances")) || [];
  return paginate(instances, page, pageSize);
}

/**
 * Get paginated list of nodes
 * 
 * @param {number} page - Page number
 * @param {number} pageSize - Items per page
 * @returns {Promise<Object>} Paginated nodes with metadata
 */
async function getPaginatedNodes(page = 1, pageSize = 20) {
  const nodes = (await db.get("nodes")) || [];
  return paginate(nodes, page, pageSize);
}

/**
 * Get paginated list of images
 * 
 * @param {number} page - Page number
 * @param {number} pageSize - Items per page
 * @returns {Promise<Object>} Paginated images with metadata
 */
async function getPaginatedImages(page = 1, pageSize = 20) {
  const images = (await db.get("images")) || [];
  return paginate(images, page, pageSize);
}

/**
 * Get paginated list of API keys
 * 
 * @param {number} page - Page number
 * @param {number} pageSize - Items per page
 * @returns {Promise<Object>} Paginated API keys with metadata
 */
async function getPaginatedAPIKeys(page = 1, pageSize = 20) {
  const apiKeys = (await db.get("apiKeys")) || [];
  return paginate(apiKeys, page, pageSize);
}

/**
 * Invalidate specific database cache entry
 * Call this after updating a record
 * 
 * @param {string} key - Database key to invalidate
 */
function invalidateCache(key) {
  cache.delete(`db_${key}`);
}

/**
 * Invalidate cache for a group of records
 * 
 * @param {Array<string>} keys - Keys to invalidate
 */
function invalidateCacheGroup(keys) {
  if (Array.isArray(keys)) {
    keys.forEach((key) => invalidateCache(key));
  }
}

/**
 * Clear all database-related cache
 */
function clearDbCache() {
  const stats = cache.stats();
  stats.keys.forEach((key) => {
    if (key.startsWith("db_")) {
      cache.delete(key);
    }
  });
}

module.exports = {
  batchGet,
  paginate,
  getPaginatedUsers,
  getPaginatedInstances,
  getPaginatedNodes,
  getPaginatedImages,
  getPaginatedAPIKeys,
  invalidateCache,
  invalidateCacheGroup,
  clearDbCache,
};
