const express = require("express");
const router = express.Router();
const { db } = require("../../handlers/db.js");
const { isAdmin } = require("../../utils/isAdmin.js");
const { paginate } = require("../../utils/dbHelper.js");
const log = new (require("cat-loggr"))();

router.get("/admin/auditlogs", isAdmin, async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize) : 50;
    const actionFilter = req.query.action || "";
    const dateRange = req.query.dateRange ? parseInt(req.query.dateRange) : null;

    log.info(`AuditLogs: action=${actionFilter}, dateRange=${dateRange}, page=${page}`);

    let audits = await db.get("audits");
    audits = audits ? JSON.parse(audits) : [];

    // Apply filters before pagination
    if (actionFilter || dateRange) {
      const now = new Date().getTime();
      audits = audits.filter(audit => {
        const actionMatch = !actionFilter || audit.action === actionFilter;
        let dateMatch = true;
        
        if (dateRange) {
          const auditTime = new Date(audit.timestamp).getTime();
          const dateDiff = (now - auditTime) / (1000 * 60 * 60 * 24);
          dateMatch = dateDiff <= dateRange;
        }
        
        return actionMatch && dateMatch;
      });
    }

    // Use pagination for audit logs
    const result = paginate(audits, page, pageSize);

    // Get unique actions for filter dropdown
    const allAudits = await db.get("audits");
    const allAuditsArray = allAudits ? JSON.parse(allAudits) : [];
    const actions = [...new Set(allAuditsArray.map(audit => audit.action))];

    res.render("admin/auditlogs", {
      req,
      user: req.user,
      audits: result.data,
      pagination: result.pagination,
      actions,
      actionFilter,
      dateRange,
      filters: { actionFilter, dateRange }
    });
  } catch (err) {
    log.error("Error fetching audits:", err);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
