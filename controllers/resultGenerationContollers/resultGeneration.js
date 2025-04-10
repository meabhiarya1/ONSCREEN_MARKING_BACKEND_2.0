import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import archiver from "archiver";
import csvToJson from "../../services/csvToJson.js";
import convertJSONToCSV from "../../services/jsonToCsv.js";
import Marks from "../../models/EvaluationModels/marksModel.js";
import Task from "../../models/taskModels/taskModel.js";
import AnswerPdf from "../../models/EvaluationModels/studentAnswerPdf.js";
import QuestionDefinition from "../../models/schemeModel/questionDefinitionSchema.js";
import { __dirname } from "../../server.js";
import { isValidObjectId } from "../../services/mongoIdValidation.js";

const generateResult = async (req, res) => {
    const { subjectcode } = req.body;
    const uploadedCsv = req.file;

    try {
        if (!subjectcode) {
            return res.status(400).json({ message: "Subject code is required." });
        }

        if (!uploadedCsv) {
            return res.status(400).json({ message: "No CSV file uploaded." });
        }

        // Create necessary folders
        const resultFolder = path.join(__dirname, "resultFolder", subjectcode);
        const tempFolder = path.join(__dirname, "temp");
        if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });
        if (!fs.existsSync(resultFolder)) fs.mkdirSync(resultFolder, { recursive: true });

        // Save uploaded CSV temporarily
        const tempCsvPath = path.join(tempFolder, uploadedCsv.originalname);
        fs.writeFileSync(tempCsvPath, fs.readFileSync(uploadedCsv.path));

        // Convert uploaded CSV to JSON
        const csvData = await csvToJson(tempCsvPath);

        // Fetch tasks and generate results
        const tasks = await Task.find({ subjectCode: subjectcode }).populate("userId", "email");
        if (tasks.length === 0) {
            return res.status(404).json({ message: "No tasks found." });
        }

        // Map taskId to user email
        const userMap = tasks.reduce((map, task) => {
            if (task.userId && task.userId.email) {
                map[task._id] = task.userId.email;
            }
            return map;
        }, {});

        const taskIds = tasks.map((task) => task._id);
        const completedBooklets = await AnswerPdf.find({ taskId: { $in: taskIds }, status: true });

        if (completedBooklets.length === 0) {
            return res.status(404).json({ message: "No completed booklets found." });
        }

        const generatingResults = await Promise.all(
            completedBooklets.map(async (booklet) => {
                const barcode = booklet.answerPdfName?.split("_")[0];
                if (!barcode) {
                    return {
                        status: "false",
                        message: "Barcode name not found",
                        bookletName: booklet.answerPdfName,
                        barcode: "",
                    };
                }

                const marks = await Marks.find({ answerPdfId: booklet._id });
                const totalMarks = marks.reduce((sum, mark) => sum + mark.allottedMarks, 0);

                // Get evaluator's email from the userMap
                const evaluatedBy = userMap[booklet.taskId] || "Unknown";

                return {
                    status: "true",
                    barcode: barcode,
                    totalMarks: totalMarks,
                    evaluatedBy: evaluatedBy,
                };
            })
        );

        // Match barcodes from the CSV with generatingResults
        const finalResults = csvData.map((row) => {
            const matchingResult = generatingResults.find(
                (result) => result.barcode === row.BARCODE
            );

            if (matchingResult) {
                return {
                    ...row,
                    MARKS: matchingResult.totalMarks,
                    EVALUATEDBY: matchingResult.evaluatedBy,
                };
            }
            return {
                ...row,
                MARKS: "N/A",
                EVALUATEDBY: "N/A",
            };
        });

        // Convert final results to CSV
        const newCsvData = convertJSONToCSV(finalResults);
        if (!newCsvData) {
            return res.status(500).json({ message: "Failed to generate CSV." });
        }

        const resultCsvPath = path.join(resultFolder, "result.csv");
        fs.writeFileSync(resultCsvPath, newCsvData);

        // Clean up temp folder
        fs.rmSync(tempFolder, { recursive: true, force: true });

        // Send JSON response to the frontend
        return res.status(200).json({
            message: "Results generated successfully.",
            data: finalResults,
            csvSavedPath: resultCsvPath,
        });
    } catch (error) {
        console.error("Error generating results:", error);
        return res.status(500).json({ message: "Failed to generate result", error: error.message });
    }
};

const getPreviousResult = async (req, res) => {
    const { subjectcode } = req.query;

    try {
        if (!subjectcode) {
            return res.status(400).json({ message: "Subject code is required." });
        }

        const resultFolderPath = path.join(__dirname, "resultFolder", subjectcode);

        if (!fs.existsSync(resultFolderPath)) {
            return res.status(404).json({ message: "No results found for this subject code." });
        }

        const files = fs.readdirSync(resultFolderPath);
        if (files.length === 0) {
            return res.status(404).json({ message: "No results found for this subject code." });
        }

        const results = files.map((filename) => {
            const filePath = path.join(resultFolderPath, filename);
            const stats = fs.statSync(filePath);

            return {
                filename: filename,
                time: stats.mtime.toISOString(),
            };
        });

        return res.status(200).json({ results });
    } catch (error) {
        console.error("Error retrieving previous results:", error);
        return res.status(500).json({ message: "Failed to retrieve results", error: error.message });
    }
};

const downloadResultByName = async (req, res) => {
    const { subjectcode, filename } = req.query;

    try {
        if (!subjectcode || !filename) {
            return res.status(400).json({ message: "Subject code and filename are required." });
        }

        const resultFolderPath = path.join(__dirname, "resultFolder", subjectcode);

        if (!fs.existsSync(resultFolderPath)) {
            return res.status(404).json({ message: "No results found for this subject code." });
        }

        const filePath = path.join(resultFolderPath, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "Result file not found." });
        }

        const result = await csvToJson(filePath);

        return res.status(200).json({ result });

    } catch (error) {
        console.error("Error downloading result:", error);
        return res.status(500).json({ message: "Failed to download result", error: error.message });
    }
};

const getCompletedBooklets = async (req, res) => {
    const { id } = req.params;

    try {
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: "Invalid task ID." });
        }

        const task = await Task.findById(id).populate("userId", "email");

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const booklets = await AnswerPdf.find({ taskId: task._id, status: true });

        if (booklets.length === 0) {
            return res.status(404).json({ message: "No completed booklets found" });
        }



        // Fetch all tasks for the subject and map user emails to taskIds
        const tasks = await Task.find({ subjectCode: task.subjectCode }).populate("userId", "email");
        const taskUserMap = tasks.reduce((map, t) => {
            if (t.userId && t.userId.email) {
                map[t._id] = t.userId.email;
            }
            return map;
        }, {});

        // Construct results with evaluator details
        const results = booklets.map((booklet) => ({
            answerPdfId: booklet._id,
            evaluatedBy: taskUserMap[booklet.taskId] || "Unknown",
        }));

        // Set up the response headers for streaming the ZIP file
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=${task.subjectCode}_completedBooklets.zip`
        );

        // Create the ZIP archive and pipe it to the response
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.pipe(res);

        // Process each booklet and add to the ZIP
        for (const booklet of booklets) {
            const bookletFolder = path.join(
                __dirname,
                `completedFolder/${task.subjectCode}/${booklet.answerPdfName}`
            );

            if (!fs.existsSync(bookletFolder)) {
                return res.status(404).json({
                    message: `Folder not found for booklet: ${booklet.answerPdfName}`,
                });
            }

            const images = fs
                .readdirSync(bookletFolder)
                .filter((file) => file.endsWith(".png"))
                .sort((a, b) => {
                    const numA = parseInt(a.split("_")[1].split(".")[0], 10);
                    const numB = parseInt(b.split("_")[1].split(".")[0], 10);
                    return numA - numB;
                });

            if (images.length === 0) {
                return res.status(404).json({
                    message: `No images found in folder for booklet: ${booklet.answerPdfName}`,
                });
            }

            // Fetch marks data for this booklet
            const marksData = await Marks.find({ answerPdfId: booklet._id });
            const questionDefinitions = await QuestionDefinition.find({
                _id: { $in: marksData.map((m) => m.questionDefinitionId) },
            });


            // Generate the PDF for this booklet
            const pdfBuffer = await generatePdfBuffer(
                images,
                bookletFolder,
                booklet.answerPdfName,
                results,
                marksData,
                questionDefinitions
            );

            // Add the PDF buffer to the ZIP archive
            archive.append(pdfBuffer, { name: `${booklet.answerPdfName}.pdf` });
        }

        // Finalize the ZIP archive
        await archive.finalize();
    } catch (error) {
        console.error("Error fetching completed booklets:", error);
        res.status(500).json({
            message: "Failed to fetch and process completed booklets.",
            error: error.message,
        });
    }
};

// Helper function to generate a PDF from images
const generatePdfBuffer = async (images, bookletFolder, bookletName, results, marksData, questionDefinitions) => {
    return new Promise((resolve, reject) => {
        const pdfBuffers = [];
        const doc = new PDFDocument();

        doc.on("data", (chunk) => pdfBuffers.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(pdfBuffers)));
        doc.on("error", (err) => reject(err));


        for (const image of images) {
            const imagePath = path.join(bookletFolder, image);
            doc.image(imagePath, 0, 0, {
                fit: [doc.page.width, doc.page.height],
            });
            doc.addPage();
        }

        // Add the summary page
        doc.addPage();

        // Add booklet name at the top
        doc.fontSize(18).text(`Booklet Name: ${bookletName || "N/A"}`, {
            align: "center",
            underline: true,
        });

        doc.moveDown(2);

        const startX = 50;
        const startY = doc.y;
        const rowHeight = 25;
        const columnWidths = [80, 80, 80, 150, 150];

        const columns = [
            { title: "Question", x: startX, width: columnWidths[0] },
            { title: "Marks", x: startX + columnWidths[0], width: columnWidths[1] },
            { title: "Page No.", x: startX + columnWidths[0] + columnWidths[1], width: columnWidths[2] },
            { title: "Time", x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], width: columnWidths[3] },
            { title: "Evaluator", x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2] + columnWidths[3], width: columnWidths[4] },
        ];

        // Add table headers
        doc.fontSize(12).font("Helvetica-Bold");
        for (const column of columns) {
            doc.text(column.title, column.x, startY, { width: column.width, align: "left" });
        }
        // Add rows from marks data
        doc.fontSize(10).font("Helvetica");
        marksData.forEach((mark, index) => {
            const question = questionDefinitions.find(q => q._id.toString() === mark.questionDefinitionId.toString());
            const rowY = startY + (index + 1) * rowHeight;

            doc.text(`Q${question?.questionsName}` || "N/A", columns[0].x, rowY, { width: columns[0].width, align: "left" });
            doc.text(mark.allottedMarks, columns[1].x, rowY, { width: columns[1].width, align: "left" });
            doc.text(index + 2, columns[2].x, rowY, { width: columns[2].width, align: "left" });
            doc.text(mark.timerStamps || "N/A", columns[3].x, rowY, { width: columns[3].width, align: "left" });
            doc.text(results[0]?.evaluatedBy || "N/A", columns[4].x, rowY, { width: columns[4].width, align: "left" });
        });

        // Calculate Total Marks
        const totalMarks = marksData.reduce((sum, mark) => sum + (Number(mark.allottedMarks) || 0), 0);

        // Print Total Marks at the bottom-right corner
        const totalMarksText = `Total Marks: ${totalMarks}`;
        const totalMarksX = startX + columnWidths.reduce((sum, width) => sum + width, 0) - 200;
        const totalMarksY = startY + (marksData.length + 1) * rowHeight + 20;

        doc.fontSize(12).font("Helvetica-Bold").text(totalMarksText, totalMarksX, totalMarksY, {
            width: 150,
            align: "right",
        });

        doc.end();
    });
};

// const generatePdfBuffer = async (images, bookletFolder, bookletName, results, marksData, questionDefinitions) => {
//     return new Promise((resolve, reject) => {
//         const pdfBuffers = [];
//         const doc = new PDFDocument();

//         doc.on("data", (chunk) => pdfBuffers.push(chunk));
//         doc.on("end", () => resolve(Buffer.concat(pdfBuffers)));
//         doc.on("error", (err) => reject(err));

//         // Add all images to the PDF
//         for (const image of images) {
//             const imagePath = path.join(bookletFolder, image);
//             doc.image(imagePath, 0, 0, {
//                 fit: [doc.page.width, doc.page.height],
//             });
//             doc.addPage();
//         }

//         // Add the summary page
//         doc.addPage();

//         // Add booklet name at the top
//         doc.fontSize(18).text(`Booklet Name: ${bookletName || "N/A"}`, {
//             align: "center",
//             underline: true,
//         });

//         doc.moveDown(2);

//         const startX = 50;
//         const startY = doc.y;
//         const rowHeight = 25;
//         const columnWidths = [80, 80, 150, 150]; // Removed the column for Page No.
//         // The column widths are adjusted accordingly

//         const columns = [
//             { title: "Question", x: startX, width: columnWidths[0] },
//             { title: "Marks", x: startX + columnWidths[0], width: columnWidths[1] },
//             // { title: "Page No.", x: startX + columnWidths[0] + columnWidths[1], width: columnWidths[2] }, // Removed Page No.
//             { title: "Time", x: startX + columnWidths[0] + columnWidths[1], width: columnWidths[2] },
//             { title: "Evaluator", x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], width: columnWidths[3] },
//         ];

//         // Add table headers
//         doc.fontSize(12).font("Helvetica-Bold");
//         for (const column of columns) {
//             doc.text(column.title, column.x, startY, { width: column.width, align: "left" });
//         }

//         // Add rows from marks data
//         doc.fontSize(10).font("Helvetica");
//         marksData.forEach((mark, index) => {
//             const question = questionDefinitions.find(q => q._id === mark.questionDefinitionId);
//             const rowY = startY + (index + 1) * rowHeight;

//             doc.text(question?.questionsName || `Q${index + 1}`, columns[0].x, rowY, { width: columns[0].width, align: "left" });
//             doc.text(mark.allottedMarks, columns[1].x, rowY, { width: columns[1].width, align: "left" });
//             // doc.text(index + 1, columns[2].x, rowY, { width: columns[2].width, align: "left" }); // Commented out Page No.
//             doc.text(mark.timerStamps || "N/A", columns[2].x, rowY, { width: columns[2].width, align: "left" });
//             doc.text(results[0]?.evaluatedBy || "N/A", columns[3].x, rowY, { width: columns[3].width, align: "left" });
//         });

//         // Calculate Total Marks
//         const totalMarks = marksData.reduce((sum, mark) => sum + (Number(mark.allottedMarks) || 0), 0);

//         // Print Total Marks at the bottom-right corner
//         const totalMarksText = `Total Marks: ${totalMarks}`;
//         const totalMarksX = startX + columnWidths.reduce((sum, width) => sum + width, 0) - 200;
//         const totalMarksY = startY + (marksData.length + 1) * rowHeight + 20;

//         doc.fontSize(12).font("Helvetica-Bold").text(totalMarksText, totalMarksX, totalMarksY, {
//             width: 150,
//             align: "right",
//         });

//         doc.end();
//     });
// };

export { generateResult, getPreviousResult, downloadResultByName, getCompletedBooklets };
