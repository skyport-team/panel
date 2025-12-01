/**
 * Simple in-memory cache system with TTL (Time To Live)
 * Used to cache frequently accessed database records
 */

class Cache {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} The cached value or undefined
   */
  get(key) {
    if (this.store.has(key)) {
      return this.store.get(key);
    }
    return undefined;
  }

  /**
   * Set a value in cache with TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (default: 5 minutes)
   */
  set(key, value, ttl = 5 * 60 * 1000) {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    this.store.set(key, value);

    // Set expiration timer
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttl);

    this.timers.set(key, timer);
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    this.store.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.store.clear();
    this.timers.clear();
  }

  /**
   * Get cache statistics
   */
  stats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
}

// Export singleton instance
module.exports = new Cache();
