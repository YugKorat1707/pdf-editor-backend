import CloudConvert from "cloudconvert";
import fs from "fs";
import multer from "multer";

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);
const upload = multer({ dest: "uploads/" });

export const officeToPdf = async (req, res) => {
  try {
    const filePath = req.file.path;

    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": {
          operation: "import/upload"
        },
        "convert-file": {
          operation: "convert",
          input: "import-file",
          output_format: "pdf"
        },
        "export-file": {
          operation: "export/url",
          input: "convert-file"
        }
      }
    });

    const uploadTask = job.tasks.find(t => t.name === "import-file");
    await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(filePath));

    const finishedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = finishedJob.tasks.find(t => t.name === "export-file");

    const fileUrl = exportTask.result.files[0].url;

    fs.unlinkSync(filePath);

    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Conversion failed" });
  }
};
