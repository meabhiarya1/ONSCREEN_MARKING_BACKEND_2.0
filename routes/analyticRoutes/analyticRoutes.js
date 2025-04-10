import express from "express";
const router = express.Router();
import { getAdminAnalytics, getEvaluatorAnalytics } from "../../controllers/analyticControllers/analyticControllers.js"

router.get('/getadminanalytics', getAdminAnalytics);
router.get('/getevaluatoranalytics', getEvaluatorAnalytics);

export default router;