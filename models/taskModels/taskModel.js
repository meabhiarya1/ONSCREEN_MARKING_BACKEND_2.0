import mongoose from "mongoose";

const taskSchema = new mongoose.Schema({
    subjectCode: {
        type: String,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    totalBooklets: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        required: true
    },
    currentFileIndex: {
        type: Number,
        default: 1
    }
});

const Task = mongoose.model("Task", taskSchema);

export default Task;