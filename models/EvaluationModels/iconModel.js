import mongoose from "mongoose";

const iconSchema = new mongoose.Schema({
    answerPdfImageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AnswerPdfImage",
        required: true
    },
    questionDefinitionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "QuestionDefinition",
        required: true
    },
    iconUrl: {
        type: String,
        required: true
    },
    question: {
        type: String,
        required: true
    },
    timeStamps: {
        type: String,
        required: true
    },
    x: {
        type: String,
        required: true
    },
    y: {
        type: String,
        required: true
    },
    width: {
        type: String,
        required: true
    },
    height: {
        type: String,
        required: true
    },
    mark: {
        type: String,
        required: true
    },
    comment: {
        type: String,
        default: ""
    }
});

const Icon = mongoose.model("Icon", iconSchema);

export default Icon;