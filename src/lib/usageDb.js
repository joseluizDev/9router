// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  appendRequestLog, flushDailyAggregates, flushDailyAggregatesSync, getActiveRequests, getChartData, getRecentLogs, getRequestDetailById, getRequestDetails, getUsageHistory, getUsageStats, saveRequestDetail, saveRequestUsage, statsEmitter, trackPendingRequest
} from "@/lib/db/index.js";
