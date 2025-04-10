import fs from "fs";
import path from "path";
import AnswerPdfImage from "../../models/EvaluationModels/answerPdfImageModel.js";
import { isValidObjectId } from "../../services/mongoIdValidation.js";
import { __dirname } from "../../server.js";

const getAnswerPdfImages = async (req, res) => {
    const { answerPdfId } = req.params;

    try {

        if (!isValidObjectId(answerPdfId)) {
            return res.status(400).json({ message: "Invalid answerPdfId." });
        }

        const answerPdfImages = await AnswerPdfImage.find({ answerPdfId });
        res.status(200).json(answerPdfImages);
    } catch (error) {
        console.error("Error fetching answerPdfImages:", error);
        res.status(500).json({ message: "Failed to fetch answerPdfImages", error: error.message });
    }
};

const updateAnswerPdfImageById = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {

        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid answerPdfImage ID." });
        }

        if (!status) {
            return res.status(400).json({ message: "Status is required." });
        }

        const answerPdfImage = await AnswerPdfImage.findOneAndUpdate({ _id: id }, { status }, { new: true });
        if (!answerPdfImage) {
            return res.status(404).json({ message: "AnswerPdfImage not found" });
        }
        res.status(200).json(answerPdfImage);
    } catch (error) {
        console.error("Error updating answerPdfImage:", error);
        res.status(500).json({ message: "Failed to update answerPdfImage", error: error.message });
    }
};

const savedAnswerImages = async (req, res) => {
    const { subjectcode, bookletName, imageName } = req.body;

    // Validation
    if (!subjectcode || !bookletName || !imageName) {
        return res.status(400).json({
            message: "subjectcode, bookletName, and imageName are required",
        });
    }

    // Define directory structure
    const mainFolder = path.join(__dirname, "completedFolder");
    const subjectFolder = path.join(mainFolder, subjectcode);
    const bookletFolder = path.join(subjectFolder, bookletName);

    try {
        // Ensure directories exist
        if (!fs.existsSync(mainFolder)) fs.mkdirSync(mainFolder);
        if (!fs.existsSync(subjectFolder)) fs.mkdirSync(subjectFolder);
        if (!fs.existsSync(bookletFolder)) fs.mkdirSync(bookletFolder);

        // Handle the uploaded file
        const uploadedFile = req.file;
        if (!uploadedFile) {
            return res.status(400).json({ message: "No image uploaded" });
        }

        // Save the image in the target folder with the provided imageName
        const filePath = path.join(bookletFolder, imageName);
        fs.copyFileSync(uploadedFile.path, filePath);

        // Respond with success
        res.status(200).json({
            message: "Image saved successfully",
            savedPath: filePath,
        });
    } catch (error) {
        console.error("Error saving the image:", error);
        res.status(500).json({ message: "Error saving the image", error });
    }
};

export { getAnswerPdfImages, updateAnswerPdfImageById, savedAnswerImages }