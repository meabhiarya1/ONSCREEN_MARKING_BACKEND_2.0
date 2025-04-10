import fs from "fs";
import path from "path";
import Task from "../../models/taskModels/taskModel.js";
import { isValidObjectId } from "../../services/mongoIdValidation.js";
import User from "../../models/authModels/User.js";
import SubjectSchemaRelation from "../../models/subjectSchemaRelationModel/subjectSchemaRelationModel.js";
import AnswerPdf from "../../models/EvaluationModels/studentAnswerPdf.js";
import Schema from "../../models/schemeModel/schema.js";
import QuestionDefinition from "../../models/schemeModel/questionDefinitionSchema.js";
import mongoose from 'mongoose';
import extractImagesFromPdf from "./extractImagesFromPDF.js";
import AnswerPdfImage from "../../models/EvaluationModels/answerPdfImageModel.js";
import Marks from "../../models/EvaluationModels/marksModel.js";
import { __dirname } from "../../server.js";
import Subject from "../../models/classModel/subjectModel.js";
import SubjectFolderModel from "../../models/StudentModels/subjectFolderModel.js";
import Icon from "../../models/EvaluationModels/iconModel.js";


const assigningTask = async (req, res) => {
    const { userId, subjectCode, bookletsToAssign = 2 } = req.body;

    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        if (!userId || !subjectCode) {
            return res.status(400).json({ message: "All fields are required" });
        }

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ message: "Invalid user ID." });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const subjectCodes = user.subjectCode;

        if (!subjectCodes || subjectCodes.length === 0) {
            return res.status(404).json({ message: "No subjects found for the user." });
        }

        const subjectDetails = await Subject.find({ _id: { $in: subjectCodes } });

        // If no subjects found
        if (subjectDetails.length === 0) {
            return res.status(404).json({ message: "No subjects found for the given IDs." });
        }


        // Check if the subject code exists
        const subject = subjectDetails.find(subject => subject.code === subjectCode);

        if (!subject) {
            return res.status(404).json({ message: "Subject not found (upload master and question booklet)." });
        }

        // Check if the folder for the subject code exists
        const rootFolder = path.join(__dirname, "processedFolder");
        const subjectFolder = path.join(rootFolder, subjectCode);

        if (!fs.existsSync(subjectFolder)) {
            return res.status(404).json({ message: "Subject folder not found." });
        }

        // Get all PDFs in the folder
        const allPdfs = fs.readdirSync(subjectFolder).filter(file => file.endsWith('.pdf'));

        // Get already assigned PDFs for this subjectCode
        const assignedPdfs = await AnswerPdf.find({ taskId: { $in: await Task.find({ subjectCode }).select('_id') } });

        const assignedPdfNames = assignedPdfs.map(pdf => pdf.answerPdfName);

        // Find unassigned PDFs
        const unassignedPdfs = allPdfs.filter(pdf => !assignedPdfNames.includes(pdf));

        if (unassignedPdfs.length === 0) {
            return res.status(400).json({ message: "All booklets are already assigned." });
        }

        // Determine the number of PDFs to assign in this request
        const pdfsToBeAssigned = unassignedPdfs.slice(0, bookletsToAssign);

        // Create a new task for this assignment
        const newTask = new Task({
            subjectCode,
            userId,
            totalBooklets: pdfsToBeAssigned.length,
            status: "inactive",
            currentFileIndex: 1,
        });

        const savedTask = await newTask.save({ session });

        // Save the assigned PDFs in the AnswerPdf model
        const answerPdfDocs = pdfsToBeAssigned.map(pdf => ({
            taskId: savedTask._id,
            answerPdfName: pdf,
            status: false
        }));

        await AnswerPdf.insertMany(answerPdfDocs, { session });

        // Calculate the total allocated PDFs dynamically
        const previousAllocations = await AnswerPdf.countDocuments({ taskId: { $in: await Task.find({ subjectCode }).select('_id') } });
        const allocatedIncrement = previousAllocations + pdfsToBeAssigned.length || 0;

        // Ensure `evaluation_pending` and `evaluated` are valid counts
        const evaluationPendingCount = await AnswerPdf.countDocuments({ status: false, taskId: savedTask._id }) || 0;
        const evaluatedCount = await AnswerPdf.countDocuments({ status: true, taskId: savedTask._id }) || 0;


        // Calculate unAllocated PDFs dynamically
        const unAllocatedCount = allPdfs.length - allocatedIncrement;

        // Update the SubjectFolder document
        await SubjectFolderModel.findOneAndUpdate(
            { folderName: subjectCode },
            {
                $set: {
                    allocated: allocatedIncrement,
                    evaluation_pending: evaluationPendingCount + pdfsToBeAssigned.length,
                    evaluated: evaluatedCount,
                    unAllocated: unAllocatedCount
                },
                updatedAt: new Date(),
            },
            { session }
        );


        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
            message: `${pdfsToBeAssigned.length} Booklets assigned successfully.`,
            assignedPdfs: pdfsToBeAssigned,
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Error assigning task:", error);
        return res.status(500).json({ error: "An error occurred while assigning the task." });
    }
};

const updateAssignedTask = async (req, res) => {

};

const removeAssignedTask = async (req, res) => {
    const { id } = req.params;

    try {
        // Validate task ID
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        // Start a session to handle the deletion as a transaction
        const session = await mongoose.startSession();
        session.startTransaction();
        // Validate if the provided task ID is a valid MongoDB ObjectId

        try {
            // Find and delete the task
            const task = await Task.findByIdAndDelete(id, { session });
            if (!task) {
                // Start a MongoDB session to handle the deletion as a transaction
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Task not found" });
            }

            // Attempt to find and delete the task by its ID
            // Delete all related AnswerPdf documents
            await AnswerPdf.deleteMany({ taskId: id }, { session });

            // If the task doesn't exist, abort the transaction and return a 404 response
            // Commit the transaction
            await session.commitTransaction();
            session.endSession();

            res.status(200).json({ message: "Task and associated PDFs deleted successfully" });
            // Delete all AnswerPdf documents associated with the task ID
        } catch (error) {
            // Rollback the transaction in case of an error
            await session.abortTransaction();
            // Commit the transaction after successful deletions
            session.endSession();
            console.error("Error during task and PDF deletion:", error);
            res.status(500).json({ message: "Failed to delete task and associated PDFs", error: error.message });
        }
        // Send a success response after task and its PDFs are deleted
    } catch (error) {
        console.error("Error deleting task:", error);
        // Rollback the transaction in case of an error during deletion
        res.status(500).json({ message: "Failed to delete task", error: error.message });
    }
};

const getAssignTaskById = async (req, res) => {
    const { id } = req.params;

    try {
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const subject = await Subject.findOne({ code: task.subjectCode });
        if (!subject) {
            return res.status(404).json({ message: "Subject not found (create subject)." });
        }

        const courseSchemaDetails = await SubjectSchemaRelation.findOne({
            subjectId: subject._id,
        });

        if (!courseSchemaDetails) {
            return res.status(404).json({ message: "Schema not found for the subject (upload master answer and master question)." });
        }

        const schemaDetails = await Schema.findOne({ _id: courseSchemaDetails.schemaId });
        if (!schemaDetails) {
            return res.status(404).json({ message: "Schema not found." });
        }

        const rootFolder = path.join(__dirname, "processedFolder");
        const subjectFolder = path.join(rootFolder, task.subjectCode);

        if (!fs.existsSync(subjectFolder)) {
            return res.status(404).json({ message: "Subject folder not found." });
        }

        const extractedBookletsFolder = path.join(subjectFolder, "extractedBooklets");
        if (!fs.existsSync(extractedBookletsFolder)) {
            fs.mkdirSync(extractedBookletsFolder, { recursive: true });
        }

        const assignedPdfs = await AnswerPdf.find({ taskId: task._id });
        if (assignedPdfs.length === 0) {
            return res.status(404).json({ message: "No PDFs assigned to this task." });
        }

        const currentPdf = assignedPdfs[task.currentFileIndex - 1];
        if (!currentPdf) {
            return res.status(404).json({ message: "No PDF found for the current file index." });
        }

        const pdfPath = path.join(subjectFolder, currentPdf.answerPdfName);
        if (!fs.existsSync(pdfPath)) {
            return res.status(404).json({ message: `PDF file ${currentPdf.answerPdfName} not found.` });
        }

        task.status = "active";
        await task.save();

        const extractedImages = await AnswerPdfImage.find({ answerPdfId: currentPdf._id });

        let extractedBookletPath = `processedFolder/${task.subjectCode}/extractedBooklets/${path.basename(currentPdf.answerPdfName, ".pdf")}`;

        if (extractedImages.length > 0) {
            const visibleImages = extractedImages.filter((_, index) => !schemaDetails.hiddenPage?.includes(index));
            return res.status(200).json({
                task,
                answerPdfDetails: currentPdf,
                schemaDetails,
                extractedBookletPath,
                answerPdfImages: visibleImages,
            });
        }

        const currentPdfFolder = path.join(extractedBookletsFolder, path.basename(currentPdf.answerPdfName, ".pdf"));
        if (!fs.existsSync(currentPdfFolder)) {
            fs.mkdirSync(currentPdfFolder, { recursive: true });
        }

        const imageFiles = await extractImagesFromPdf(pdfPath, currentPdfFolder);

        const imageDocs = imageFiles.map((imageFileName, i) => ({
            answerPdfId: currentPdf._id,
            name: imageFileName,
            status: i === 0 ? "visited" : "notVisited",
        }));

        const insertedImages = await AnswerPdfImage.insertMany(imageDocs);

        // Define directory structure for completedFolder
        const completedFolder = path.join(__dirname, "completedFolder");
        const subjectCompletedFolder = path.join(completedFolder, task.subjectCode);
        const bookletFolder = path.join(subjectCompletedFolder, path.basename(currentPdf.answerPdfName, ".pdf"));

        if (!fs.existsSync(completedFolder)) fs.mkdirSync(completedFolder);
        if (!fs.existsSync(subjectCompletedFolder)) fs.mkdirSync(subjectCompletedFolder);
        if (!fs.existsSync(bookletFolder)) fs.mkdirSync(bookletFolder);

        const hiddenPages = schemaDetails.hiddenPage || [];
        const hiddenImages = insertedImages.filter((_, index) => hiddenPages.includes(index));

        for (const image of hiddenImages) {
            const sourceImagePath = path.join(currentPdfFolder, image.name);
            const destinationImagePath = path.join(bookletFolder, image.name);

            if (fs.existsSync(sourceImagePath)) {
                fs.copyFileSync(sourceImagePath, destinationImagePath);
            } else {
                console.error(`Hidden image not found: ${sourceImagePath}`);
            }
        }

        const visibleImages = insertedImages.filter((_, index) => !hiddenPages.includes(index));

        return res.status(200).json({
            task,
            answerPdfDetails: currentPdf,
            schemaDetails,
            extractedBookletPath,
            answerPdfImages: visibleImages, // Send only non-hidden images
        });
    } catch (error) {
        console.error("Error fetching task:", error.message);
        res.status(500).json({ message: "Failed to process task", error: error.message });
    }
};

// inittal one 
// const getAssignTaskById = async (req, res) => {
//     const { id } = req.params;

//     // Log and respond with an error if the process fails
//     try {
//         if (!isValidObjectId(id)) {
//             return res.status(400).json({ message: "Invalid task ID." });
//         }

//         const task = await Task.findById(id);

//         if (!task) {
//             return res.status(404).json({ message: "Task not found" });
//         }

//         const subject = await Subject.findOne({ code: task.subjectCode });

//         if (!subject) {
//             return res.status(404).json({ message: "Subject not found (create subject)." });
//         }

//         const courseSchemaDetails = await SubjectSchemaRelation.findOne({
//             subjectId: subject._id,
//         });

//         if (!courseSchemaDetails) {
//             return res.status(404).json({ message: "Schema not found for the subject (upload master answer and master question)." });
//         }

//         const schemaDetails = await Schema.findOne({ _id: courseSchemaDetails.schemaId });

//         if (!schemaDetails) {
//             return res.status(404).json({ message: "Schema not found." });
//         }

//         const { subjectCode, currentFileIndex, totalBooklets } = task;

//         // Validate currentFileIndex
//         if (currentFileIndex < 1 || currentFileIndex > totalBooklets) {
//             return res.status(400).json({ message: "Invalid current file index." });
//         }

//         const rootFolder = path.join(__dirname, "processedFolder");
//         const subjectFolder = path.join(rootFolder, subjectCode);

//         if (!fs.existsSync(subjectFolder)) {
//             return res.status(404).json({ message: "Subject folder not found." });
//         }

//         // Ensure `extractedBooklets` folder exists
//         const extractedBookletsFolder = path.join(subjectFolder, "extractedBooklets");
//         if (!fs.existsSync(extractedBookletsFolder)) {
//             fs.mkdirSync(extractedBookletsFolder, { recursive: true });
//         }

//         // Get all assigned PDFs for this task
//         const assignedPdfs = await AnswerPdf.find({ taskId: task._id });

//         if (assignedPdfs.length === 0) {
//             return res.status(404).json({ message: "No PDFs assigned to this task." });
//         }

//         // Get the current PDF based on the currentFileIndex
//         const currentPdf = assignedPdfs[currentFileIndex - 1];

//         if (!currentPdf) {
//             return res.status(404).json({ message: "No PDF found for the current file index." });
//         }

//         const pdfPath = path.join(subjectFolder, currentPdf.answerPdfName);

//         if (!fs.existsSync(pdfPath)) {
//             return res.status(404).json({ message: `PDF file ${currentPdf.answerPdfName} not found.` });
//         }


//         task.status = "active";
//         await task.save();

//         // Check if the images have already been extracted and stored in the database
//         const extractedImages = await AnswerPdfImage.find({ answerPdfId: currentPdf._id });

//         let extractedBookletPath = `processedFolder/${task.subjectCode}/extractedBooklets/${path.basename(currentPdf.answerPdfName, '.pdf')}`;

//         if (extractedImages.length > 0) {
//             return res.status(200).json({
//                 task,
//                 answerPdfDetails: currentPdf,
//                 schemaDetails,
//                 extractedBookletPath,
//                 answerPdfImages: extractedImages
//             });
//         }

//         // Create a folder for the current PDF in `extractedBooklets`
//         const currentPdfFolder = path.join(extractedBookletsFolder, path.basename(currentPdf.answerPdfName, ".pdf"));
//         if (!fs.existsSync(currentPdfFolder)) {
//             fs.mkdirSync(currentPdfFolder, { recursive: true });
//         }

//         // Extract images from the PDF
//         const imageFiles = await extractImagesFromPdf(pdfPath, currentPdfFolder);


//         // Save the extracted images' details in the AnswerPdfImage collection
//         const imageDocs = imageFiles.map((imageFileName, i) => ({
//             answerPdfId: currentPdf._id,
//             name: imageFileName,
//             status: i === 0 ? "visited" : "notVisited"
//         }));

//         let insertedImages = await AnswerPdfImage.insertMany(imageDocs);
//         // Update the currentFileIndex in the task

//         //   // Define directory structure
//         //     const mainFolder = path.join(__dirname, "completedFolder");
//         //     const complededFolder = path.join(mainFolder, subjectcode);
//         //     const bookletFolder = path.join(subjectFolder, currentPdf.answerPdfName);

//         // // Ensure directories exist
//         // if (!fs.existsSync(mainFolder)) fs.mkdirSync(mainFolder);
//         // if (!fs.existsSync(subjectFolder)) fs.mkdirSync(complededFolder);
//         // if (!fs.existsSync(bookletFolder)) fs.mkdirSync(bookletFolder);

//         // const hiddenPage = schemaDetails.hiddenPage;


//         return res.status(200).json({
//             task,
//             answerPdfDetails: currentPdf,
//             schemaDetails,
//             extractedBookletPath,
//             answerPdfImages: insertedImages
//         });

//     } catch (error) {
//         console.error("Error fetching task:", error);
//         res.status(500).json({ message: "Failed to process task", error: error.message });
//     }
// };


const getAllTaskHandler = async (req, res) => {
    try {
        const tasks = await Task.find().populate('userId', 'name email');
        res.status(200).json(tasks);
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
    }
};

const getAllAssignedTaskByUserId = async (req, res) => {
    const { userId } = req.params;
    try {
        if (!isValidObjectId(userId)) {
            return res.status(400).json({ message: "Invalid user ID." });
        }
        const tasks = await Task.find({
            userId,
            status: { $ne: 'success' }
        });

        if (tasks.length === 0) {
            return res.status(404).json({ message: "No tasks found.", tasks: [] });
        }

        res.status(200).json(tasks);
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
    }
}

const updateCurrentIndex = async (req, res) => {
    const { id } = req.params;
    const { currentIndex } = req.body;

    try {

        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        if (!currentIndex) {
            return res.status(400).json({ message: "Invalid current index." });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }


        // Ensure currentIndex is a valid number and within the range of totalFiles
        if (currentIndex < 1 || currentIndex > task.totalFiles) {
            return res.status(400).json({ message: `currentIndex should be between 1 and ${task.totalFiles}` });
        }

        // Update currentFileIndex
        task.currentFileIndex = currentIndex;
        await task.save();

        res.status(200).json(task);
    } catch (error) {
        console.error("Error updating task:", error);
        res.status(500).json({ message: "Failed to update task", error: error.message });
    }
};

const getQuestionDefinitionTaskId = async (req, res) => {
    const { answerPdfId, taskId } = req.query;

    try {
        // Validate IDs
        if (!isValidObjectId(taskId)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        if (!isValidObjectId(answerPdfId)) {
            return res.status(400).json({ message: "Invalid answerPdfId." });
        }

        // Retrieve the task
        const task = await Task.findById(taskId);

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const subject = await Subject.findOne({ code: task.subjectCode });

        if (!subject) {
            return res.status(404).json({ message: "Subject not found (create subject)." });
        }

        const courseSchemaDetails = await SubjectSchemaRelation.findOne({
            subjectId: subject._id,
        });

        if (!courseSchemaDetails) {
            return res.status(404).json({ message: "Schema not found for the subject (upload master answer and master question)." });
        }

        const schemaDetails = await Schema.findOne({ _id: courseSchemaDetails.schemaId });

        if (!schemaDetails) {
            return res.status(404).json({ message: "Schema not found." });
        }

        // Fetch all QuestionDefinitions for the schema
        const questionDefinitions = await QuestionDefinition.find({ schemaId: schemaDetails.id });

        if (!questionDefinitions || questionDefinitions.length === 0) {
            return res.status(404).json({ message: "No QuestionDefinitions found" });
        }

        // Fetch Marks data based on the provided answerPdfId and questionDefinitionId
        const marksData = await Marks.find({ answerPdfId: answerPdfId });

        // Add marks related data to the question definitions
        const enrichedQuestionDefinitions = await Promise.all(
            questionDefinitions.map(async (question) => {
                // Find the related Marks entry for the current questionDefinitionId
                const marks = marksData.find(m => m.questionDefinitionId.toString() === question._id.toString());

                // If Marks entry exists, add its data, otherwise leave as empty
                const marksInfo = marks ? {
                    allottedMarks: marks.allottedMarks,
                    answerPdfId: marks.answerPdfId,
                    timerStamps: marks.timerStamps,
                    isMarked: marks.isMarked
                } : {
                    allottedMarks: 0,
                    answerPdfId: answerPdfId,
                    timerStamps: "",
                    isMarked: false
                };

                // Return the enriched question with Marks data
                return {
                    ...question.toObject(),
                    ...marksInfo
                };
            })
        );

        // Send the enriched data as a response
        res.status(200).json(enrichedQuestionDefinitions);

    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
    }
};

const getAllTasksBasedOnSubjectCode = async (req, res) => {
    const { subjectcode } = req.query;

    try {

        if (!subjectcode) {
            return res.status(400).json({ message: "Subject code is required." });
        }

        const tasks = await Task.find({ subjectCode: subjectcode }).populate('userId', 'name email');

        res.status(200).json(tasks);
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
    }
}

const completedBookletHandler = async (req, res) => {
    const { answerpdfid } = req.params;

    try {
        // Validate answerPdfId
        if (!isValidObjectId(answerpdfid)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        const currentPdf = await AnswerPdf.findOne({ _id: answerpdfid });
        if (!currentPdf) {
            return res.status(404).json({ message: "No PDF found for the current file index." });
        }

        const task = await Task.findById(currentPdf.taskId);
        if (!task) {
            return res.status(404).json({ message: "Task not found." });
        }

        // Find all tasks related to the same subjectCode
        const tasks = await Task.find({ subjectCode: task.subjectCode });

        // Check if all images are annotated
        const answerPdfImages = await AnswerPdfImage.find({ answerPdfId: currentPdf._id });
        const iconsCheck = await Promise.all(
            answerPdfImages.map(async (answerPdfImage) => {
                const iconExists = await Icon.findOne({ answerPdfImageId: answerPdfImage._id });
                return iconExists;
            })
        );

        if (iconsCheck.includes(null)) {
            return res.status(404).json({ message: "Ensure all answer sheets are annotated/marked.", success: false });
        }

        // Update AnswerPdf status to 'true'
        await AnswerPdf.findByIdAndUpdate(currentPdf._id, { status: true });

        let totalBooklets = 0;
        let completedBooklets = 0;

        // Process each task and update the booklet counts
        for (const currentTask of tasks) {
            const answerPdfs = await AnswerPdf.find({ taskId: currentTask._id, status: true });
            totalBooklets += currentTask.totalBooklets;
            completedBooklets += answerPdfs.length;
        }

        const subjectFolderDetails = await SubjectFolderModel.findOne({ folderName: task.subjectCode });
        if (!subjectFolderDetails) {
            return res.status(404).json({ message: "Subject folder not found" });
        }

        // Update folder details
        subjectFolderDetails.evaluated = completedBooklets;
        subjectFolderDetails.evaluation_pending = totalBooklets - completedBooklets;
        await subjectFolderDetails.save();

        // Check if all booklets are completed
        if (completedBooklets === totalBooklets) {
            task.status = "success";
            await task.save();
            return res.status(200).json({ message: "Task is completed", success: true });
        }

        res.status(200).json({ message: "All images have been annotated/marked.", success: true });

    } catch (error) {
        console.error("Error in completedBookletHandler:", error);
        res.status(500).json({ message: "Failed to complete task", error: error.message });
    }
};

const checkTaskCompletionHandler = async (req, res) => {
    const { id } = req.params;

    try {
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        const task = await Task.findById(id);

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const tasks = await Task.find({ subjectCode: task.subjectCode });

        let totalBooklets = 0;
        let completedBooklets = 0;

        for (const currentTask of tasks) {
            const answerPdfs = await AnswerPdf.find({ taskId: currentTask._id, status: true });
            totalBooklets += currentTask.totalBooklets;
            completedBooklets += answerPdfs.length;
        }

        const subjectFolderDetails = await SubjectFolderModel.findOne({ folderName: task.subjectCode });

        subjectFolderDetails.evaluated = completedBooklets;
        subjectFolderDetails.evaluation_pending = totalBooklets - completedBooklets;
        await subjectFolderDetails.save();

        const booklets = await AnswerPdf.find({ taskId: id, status: false });

        if (booklets.length === 0) {
            task.status = "success";
            await task.save();
            return res.status(200).json({ message: "Task is completed", success: true });
        }

        return res.status(200).json({ message: "Task is not completed", success: false });

    }
    catch (error) {
        return res.status(500).json({ message: "Failed to fetch tasks", error: error.message });
    }
}

export {
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
};

