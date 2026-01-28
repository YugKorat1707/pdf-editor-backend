require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const CloudConvert = require("cloudconvert");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
} = require("pdf-lib");

const AdmZip = require("adm-zip");
const pdfParse = require("pdf-parse");
const { Document, Packer, Paragraph } = require("docx");
const ExcelJS = require("exceljs");
//const PptxGenJS = require("pptxgenjs");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 5000;
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

app.use(cors());
app.use(express.json());

// ------------------ FOLDERS ------------------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({ dest: uploadDir });

// ------------------ DB ------------------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

// ------------------ AUTH ------------------
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  phone: String,
  email: { type: String, unique: true }
});

const User = mongoose.model("User", userSchema);

app.post("/api/auth/signup", async (req,res)=>{
  const {username,password,phone,email}=req.body;
  const hashed = await bcrypt.hash(password,10);
  await new User({username,password:hashed,phone,email}).save();
  res.send("User created");
});

app.post("/api/auth/login", async (req,res)=>{
  const {email,password}=req.body;
  const user = await User.findOne({email});
  if(!user) return res.status(401).send("Invalid");
  const ok = await bcrypt.compare(password,user.password);
  if(!ok) return res.status(401).send("Invalid");
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({token,username:user.username});
});

// ================= CLOUDCONVERT OFFICE → PDF =================
// app.post("/office-to-pdf", upload.single("file"), async (req, res) => {
//   try {
//     const job = await cloudConvert.jobs.create({
//       tasks: {
//         "import-file": { operation: "import/upload" },
//         "convert-file": {
//           operation: "convert",
//           input: "import-file",
//           output_format: "pdf"
//         },
//         "export-file": { operation: "export/url", input: "convert-file" }
//       }
//     });

//     const uploadTask = job.tasks.find(t => t.name === "import-file");
//     await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(req.file.path));

//     const finishedJob = await cloudConvert.jobs.wait(job.id);
//     const exportTask = finishedJob.tasks.find(t => t.name === "export-file");

//     const fileUrl = exportTask.result.files[0].url;

//     fs.unlinkSync(req.file.path);
//     res.json({ url: fileUrl });

//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Office to PDF failed");
//   }
// });
app.post("/office-to-pdf", upload.single("file"), async (req, res) => {
  try {
    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": { operation: "import/upload" },

        "convert-file": {
          operation: "convert",
          input: "import-file",
          input_format: "docx",
          input_format: "xls",
          input_format: "pptx",
          output_format: "pdf"
        },

        "export-file": {
          operation: "export/url",
          input: "convert-file"
        }
      }
    });

    const uploadTask = job.tasks.find(t => t.name === "import-file");
    await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(req.file.path));

    const finishedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = finishedJob.tasks.find(t => t.name === "export-file");

    const fileUrl = exportTask.result.files[0].url;

    fs.unlinkSync(req.file.path);
    res.json({ url: fileUrl });

  } catch (err) {
    console.error("Office to PDF error:", err);
    res.status(500).send("Office to PDF failed");
  }
});

//pdf to ppt
app.post("/pdf-to-ppt", upload.single("file"), async (req, res) => {
  try {
    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": { operation: "import/upload" },

        "convert-file": {
          operation: "convert",
          input: "import-file",
          input_format: "pdf",
          output_format: "pptx"
        },

        "export-file": {
          operation: "export/url",
          input: "convert-file"
        }
      }
    });

    const uploadTask = job.tasks.find(t => t.name === "import-file");
    await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(req.file.path));

    const finishedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = finishedJob.tasks.find(t => t.name === "export-file");

    const fileUrl = exportTask.result.files[0].url;

    fs.unlinkSync(req.file.path);
    res.json({ url: fileUrl });

  } catch (err) {
    console.error("PDF to PPT error:", err);
    res.status(500).send("PDF to PPT conversion failed");
  }
});
app.post("/excel-to-pdf", upload.single("file"), async (req, res) => {
  try {
    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": { operation: "import/upload" },

        "convert-file": {
          operation: "convert",
          input: "import-file",
          input_format: "xlsx",
          output_format: "pdf"
        },

        "export-file": {
          operation: "export/url",
          input: "convert-file"
        }
      }
    });

    const uploadTask = job.tasks.find(t => t.name === "import-file");
    await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(req.file.path));

    const finishedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = finishedJob.tasks.find(t => t.name === "export-file");

    const fileUrl = exportTask.result.files[0].url;

    fs.unlinkSync(req.file.path);
    res.json({ url: fileUrl });

  } catch (err) {
    console.error("Excel to PDF error:", err);
    res.status(500).send("Excel to PDF failed");
  }
});


// ================= PDF TO WORD =================
app.post("/pdf-to-word", upload.single("pdf"), async (req, res) => {
  const data = await pdfParse(fs.readFileSync(req.file.path));
  const doc = new Document({
    sections: [{ children: data.text.split("\n").map(t => new Paragraph(t)) }]
  });

  const out = path.join(uploadDir, `pdf_${Date.now()}.docx`);
  fs.writeFileSync(out, await Packer.toBuffer(doc));
  fs.unlinkSync(req.file.path);
  res.download(out,()=>fs.unlinkSync(out));
});

// ================= MERGE PDF =================
app.post("/merge", upload.array("pdfs"), async (req,res)=>{
  const merged = await PDFDocument.create();
  for(const file of req.files){
    const pdf = await PDFDocument.load(fs.readFileSync(file.path));
    const pages = await merged.copyPages(pdf,pdf.getPageIndices());
    pages.forEach(p=>merged.addPage(p));
    fs.unlinkSync(file.path);
  }
  const out = path.join(uploadDir,`merged_${Date.now()}.pdf`);
  fs.writeFileSync(out, await merged.save());
  res.download(out,()=>fs.unlinkSync(out));
});

// ================= SPLIT PDF =================
app.post("/split", upload.single("pdf"), async (req,res)=>{
  const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
  const zip = new AdmZip();

  for(let i=0;i<pdf.getPageCount();i++){
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(pdf,[i]);
    doc.addPage(page);
    zip.addFile(`page-${i+1}.pdf`,Buffer.from(await doc.save()));
  }

  fs.unlinkSync(req.file.path);
  res.send(zip.toBuffer());
});

// ================= ROTATE =================
app.post("/rotate-pdf", upload.single("pdf"), async (req,res)=>{
  const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
  pdf.getPages().forEach(p=>p.setRotation(degrees(90)));
  const out = path.join(uploadDir,`rotated_${Date.now()}.pdf`);
  fs.writeFileSync(out, await pdf.save());
  fs.unlinkSync(req.file.path);
  res.download(out,()=>fs.unlinkSync(out));
});

// ================= HTML TO PDF =================
app.post("/html-to-pdf", async (req,res)=>{
  const browser = await puppeteer.launch({args:["--no-sandbox"]});
  const page = await browser.newPage();
  await page.setContent(req.body.html);
  const out = path.join(uploadDir,`html_${Date.now()}.pdf`);
  await page.pdf({path:out});
  await browser.close();
  res.download(out,()=>fs.unlinkSync(out));
});

// ================= SERVER =================
app.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});