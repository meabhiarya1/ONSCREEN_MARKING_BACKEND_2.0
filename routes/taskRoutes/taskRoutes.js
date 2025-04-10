import express from "express";
const router = express.Router();

import {
    assigningTask,
    updateAssignedTask,
    removeAssignedTask,
    getAssignTaskById,
    getAllAssignedTaskByUserId,
    getAllTaskHandler,
    updateCurrentIndex,
    getQuestionDefinitionTaskId,
    getAllTasksBasedOnSubjectCode,
    completedBookletHandler,
    checkTaskCompletionHandler
} from "../../controllers/taskControllers/taskControllers.js";

import authMiddleware from "../../Middlewares/authMiddleware.js";

/* -------------------------------------------------------------------------- */
/*                           TASK ROUTES                                      */
/* -------------------------------------------------------------------------- */

router.post("/create/task", assigningTask);
router.put("/update/task/:id", updateAssignedTask);
router.put("/update/task/currentIndex/:id", updateCurrentIndex);
router.delete("/remove/task/:id", removeAssignedTask);
router.get("/get/all/tasks", getAllTaskHandler);
router.get("/get/task/:id", getAssignTaskById);
router.get("/get/questiondefinition", getQuestionDefinitionTaskId);
router.get("/getall/tasks/:userId", getAllAssignedTaskByUserId);
router.get("/subjectcode", getAllTasksBasedOnSubjectCode);
router.put("/completedbooklet/:answerpdfid", completedBookletHandler);
router.put("/checktaskcompletion/:id", checkTaskCompletionHandler);

export default router;
