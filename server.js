const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { execFile } = require("child_process");

const {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
} = require("pdf-lib");

const AdmZip = require("adm-zip");
const pdfParse = require("pdf-parse");
const { Document, Packer, Paragraph } = require("docx");
//const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const PptxGenJS = require("pptxgenjs");
const libre = require("libreoffice-convert");
const puppeteer = require("puppeteer");
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
}));

import mongoose from "mongoose";

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("❌ MONGODB_URI is not defined");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  });


// ------------------ FOLDERS ------------------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ------------------ MULTER ------------------
const upload = multer({ dest: uploadDir });

const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true }
});

const User = mongoose.model('User', userSchema);

// SIGNUP ROUTE
app.post('/api/auth/signup', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
        return res.status(500).send("Database not connected yet.");
    }
    try {
        const { username, password, phone, email } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, phone, email });
        await newUser.save();
        res.status(201).send("User registered successfully");
    } catch (err) {
        res.status(400).send("Error creating user: " + err.message);
    }
});

// LOGIN ROUTE
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ userId: user._id }, 'YOUR_SECRET_KEY', { expiresIn: '24h' });
        res.json({ token, username: user.username });
    } else {
        res.status(401).send("Invalid credentials");
    }
});

// ------------------ MERGE PDF ------------------
app.post("/merge", upload.array("pdfs"), async (req, res) => {
  try {
    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      try {
        const pdfBytes = fs.readFileSync(file.path);
        const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(p => mergedPdf.addPage(p));
      } catch (err) {
        console.log("Skipping broken PDF:", file.originalname);
      } finally {
        fs.unlinkSync(file.path);
      }
    }

    const out = path.join(uploadDir, `merged_${Date.now()}.pdf`);
    fs.writeFileSync(out, await mergedPdf.save());
    res.download(out, () => fs.unlinkSync(out));
  } catch (err) {
    console.error(err);
    res.status(500).send("Merge failed");
  }
});

// ------------------ SPLIT PDF ------------------
app.post("/split", upload.single("pdf"), async (req, res) => {
  try {
    const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
    const zip = new AdmZip();

    for (let i = 0; i < pdf.getPageCount(); i++) {
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(pdf, [i]);
      doc.addPage(page);
      zip.addFile(`page-${i + 1}.pdf`, Buffer.from(await doc.save()));
    }

    fs.unlinkSync(req.file.path);
    res.set("Content-Type", "application/zip");
    res.send(zip.toBuffer());
  } catch {
    res.status(500).send("Split failed");
  }
});

// ------------------ COMPRESS PDF ------------------
app.post("/compress", upload.single("pdf"), async (req, res) => {
  try {
    const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
    const out = path.join(uploadDir, `compressed_${Date.now()}.pdf`);
    fs.writeFileSync(out, await pdf.save({ useObjectStreams: true }));
    fs.unlinkSync(req.file.path);
    res.download(out, () => fs.unlinkSync(out));
  } catch {
    res.status(500).send("Compression failed");
  }
});

// ------------------ PDF TO WORD ------------------
app.post("/pdf-to-word", upload.single("pdf"), async (req, res) => {
  try {
    const data = await pdfParse(fs.readFileSync(req.file.path));
    const paragraphs = data.text
      .split("\n")
      .map(line => new Paragraph(line));

    const doc = new Document({
      sections: [{ children: paragraphs }],
    });

    const out = path.join(uploadDir, `pdf_${Date.now()}.docx`);
    fs.writeFileSync(out, await Packer.toBuffer(doc));
    fs.unlinkSync(req.file.path);
    res.download(out, () => fs.unlinkSync(out));
  } catch {
    res.status(500).send("PDF to Word failed");
  }
});

// ------------------ PDF TO EXCEL ------------------
app.post("/pdf-to-excel", upload.single("pdf"), async (req, res) => {
  try {
    const data = await pdfParse(fs.readFileSync(req.file.path));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");

    data.text.split("\n").forEach(line => {
      if (line.trim()) sheet.addRow(line.split(/\s{2,}/));
    });

    const out = path.join(uploadDir, `pdf_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(out);
    fs.unlinkSync(req.file.path);
    res.download(out, () => fs.unlinkSync(out));
  } catch {
    res.status(500).send("PDF to Excel failed");
  }
});

// ------------------ EXCEL TO PDF ------------------
// ------------------ EXCEL TO PDF (LIBREOFFICE) ------------------
app.post("/excel-to-pdf", upload.single("excel"), (req, res) => {
  try {
    const soffice =
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

    execFile(
      soffice,
      [
        "--headless",
        "--convert-to",
        "pdf",
        req.file.path,
        "--outdir",
        uploadDir,
      ],
      (err) => {
        if (err) {
          console.error("LibreOffice error:", err);
          return res.status(500).send("Excel to PDF failed");
        }

        const pdfPath = path.join(
          uploadDir,
          path.basename(req.file.path, path.extname(req.file.path)) + ".pdf"
        );

        fs.unlinkSync(req.file.path);
        res.download(pdfPath, () => fs.unlinkSync(pdfPath));
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Excel to PDF failed");
  }
});

// ------------------ PPT TO PDF (LIBREOFFICE) ------------------
app.post("/ppt-to-pdf", upload.single("ppt"), (req, res) => {
  const soffice = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

  execFile(
    soffice,
    ["--headless", "--convert-to", "pdf", req.file.path, "--outdir", uploadDir],
    err => {
      if (err) return res.status(500).send("PPT to PDF failed");

      const pdfPath = path.join(
        uploadDir,
        path.basename(req.file.path, path.extname(req.file.path)) + ".pdf"
      );

      fs.unlinkSync(req.file.path);
      res.download(pdfPath, () => fs.unlinkSync(pdfPath));
    }
  );
});

// ------------------ PDF TO PPT ------------------
app.post("/pdf-to-ppt", upload.single("pdf"), async (req, res) => {
  try {
    const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
    const pptx = new PptxGenJS();

    for (let i = 0; i < pdf.getPageCount(); i++) {
      const slide = pptx.addSlide();
      slide.addText(`Slide ${i + 1}`, { x: 1, y: 1, fontSize: 24 });
    }

    const out = path.join(uploadDir, `pdf_${Date.now()}.pptx`);
    await pptx.writeFile(out);
    fs.unlinkSync(req.file.path);
    res.download(out, () => fs.unlinkSync(out));
  } catch {
    res.status(500).send("PDF to PPT failed");
  }
});

// ------------------ ROTATE PDF ------------------
app.post("/rotate-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
    const pages = pdf.getPages();
    const angle = Number(req.body.angle || 90);

    pages.forEach(p => p.setRotation(degrees(angle)));

    const out = path.join(uploadDir, `rotated_${Date.now()}.pdf`);
    fs.writeFileSync(out, await pdf.save());
    fs.unlinkSync(req.file.path);
    res.download(out, () => fs.unlinkSync(out));
  } catch {
    res.status(500).send("Rotate failed");
  }
});

// ------------------ PAGE NUMBERS ------------------
app.post("/page-numbers", upload.single("pdf"), async (req, res) => {
  const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  pdf.getPages().forEach((page, i) => {
    page.drawText(`${i + 1}`, { x: 550, y: 20, size: 12, font });
  });

  const out = path.join(uploadDir, `pages_${Date.now()}.pdf`);
  fs.writeFileSync(out, await pdf.save());
  fs.unlinkSync(req.file.path);
  res.download(out, () => fs.unlinkSync(out));
});

// ------------------ WATERMARK ------------------
app.post("/watermark", upload.single("pdf"), async (req, res) => {
  const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  pdf.getPages().forEach(page => {
    const { width, height } = page.getSize();
    page.drawText(req.body.text || "SAMPLE", {
      x: width / 4,
      y: height / 2,
      size: 50,
      rotate: degrees(45),
      font,
      color: rgb(0.7, 0.7, 0.7),
      opacity: 0.3,
    });
  });

  const out = path.join(uploadDir, `watermark_${Date.now()}.pdf`);
  fs.writeFileSync(out, await pdf.save());
  fs.unlinkSync(req.file.path);
  res.download(out, () => fs.unlinkSync(out));
});

// ------------------ CROP PDF ------------------
app.post("/crop-pdf", upload.single("pdf"), async (req, res) => {
  const { x, y, width, height } = req.body;
  const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
  pdf.getPages().forEach(p =>
    p.setCropBox(+x, +y, +width, +height)
  );

  const out = path.join(uploadDir, `crop_${Date.now()}.pdf`);
  fs.writeFileSync(out, await pdf.save());
  fs.unlinkSync(req.file.path);
  res.download(out, () => fs.unlinkSync(out));
});
app.post("/images-to-pdf", upload.array("images"), async (req, res) => {
  try {
    const pdf = await PDFDocument.create();

    for (const file of req.files) {
      const imgBytes = fs.readFileSync(file.path);
      let image;

      if (file.mimetype.includes("png")) {
        image = await pdf.embedPng(imgBytes);
      } else {
        image = await pdf.embedJpg(imgBytes);
      }

      const page = pdf.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });

      fs.unlinkSync(file.path);
    }

    const out = path.join(uploadDir, `images_${Date.now()}.pdf`);
    fs.writeFileSync(out, await pdf.save());
    res.download(out, () => fs.unlinkSync(out));
  } catch (err) {
    console.error(err);
    res.status(500).send("Images to PDF failed");
  }
});

/* =====================================================
   WORD → PDF
===================================================== */
//const util = require("util");
//libre.convertAsync = util.promisify(libre.convert);

app.post("/word-to-pdf", upload.single("file"), (req, res) => {
  try {
    const soffice = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

    execFile(
      soffice,
      [
        "--headless",
        "--convert-to",
        "pdf",
        req.file.path,
        "--outdir",
        uploadDir,
      ],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Word to PDF failed");
        }

        const pdfPath = path.join(
          uploadDir,
          path.basename(req.file.path, path.extname(req.file.path)) + ".pdf"
        );

        fs.unlinkSync(req.file.path);
        res.download(pdfPath, () => fs.unlinkSync(pdfPath));
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Word to PDF failed");
  }
});



/* =====================================================
   HTML → PDF
===================================================== */
app.post("/html-to-pdf", async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).send("HTML required");

    const out = path.join(uploadDir, `html_${Date.now()}.pdf`);

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: out, format: "A4" });
    await browser.close();

    res.download(out, () => fs.unlinkSync(out));
  } catch (err) {
    console.error(err);
    res.status(500).send("HTML to PDF failed");
  }
});
/* =====================================================
   UNLOCK PDF
===================================================== */
app.post("/unlock-pdf", upload.single("pdf"), (req, res) => {
  const { password } = req.body;
  const input = req.file.path;
  const output = path.join(uploadDir, `unlocked_${Date.now()}.pdf`);

  execFile(
    "qpdf",
    [`--password=${password}`, "--decrypt", input, output],
    (err) => {
      if (err) {
        return res.status(400).send("Wrong password");
      }

      fs.unlinkSync(input);
      res.download(output, () => fs.unlinkSync(output));
    }
  );
});

/* =====================================================
   PROTECT PDF (Strict Password Enforcement)
===================================================== */
app.post("/protect-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).send("Password required");

    const pdfBytes = fs.readFileSync(req.file.path);
    // Load the PDF into memory
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // CRITICAL: The save options must contain the password
    const protectedBytes = await pdfDoc.save({
      userPassword: password,   // Password required to OPEN the file
      ownerPassword: password,  // Password required to CHANGE permissions
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
    });

    const outPath = path.join(uploadDir, `protected_${Date.now()}.pdf`);
    fs.writeFileSync(outPath, protectedBytes);
    
    // Clean up temporary upload
    fs.unlinkSync(req.file.path);

    // Download and cleanup output
    res.download(outPath, "protected.pdf", () => {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    });
  } catch (err) {
    console.error("Encryption error:", err);
    res.status(500).send("Encryption failed.");
  }
});
// app.post("/edit-text", upload.single("pdf"), async (req, res) => {
//   const { text, x, y } = req.body;

//   const pdf = await PDFDocument.load(fs.readFileSync(req.file.path));
//   const font = await pdf.embedFont(StandardFonts.Helvetica);

//   const page = pdf.getPages()[0];
//   page.drawText(text, {
//     x: Number(x),
//     y: Number(y),
//     size: 14,
//     font,
//     color: rgb(0, 0, 0),
//   });

//   const out = path.join(uploadDir, `text_${Date.now()}.pdf`);
//   fs.writeFileSync(out, await pdf.save());

//   fs.unlinkSync(req.file.path);
//   res.download(out, () => fs.unlinkSync(out));
// });


// ------------------ SERVER ------------------

app.post("/overwrite-text", upload.single("pdf"), async (req, res) => {
  const pdfBytes = fs.readFileSync(req.file.path);
  const texts = JSON.parse(req.body.texts);

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];

  texts.forEach(t => {
    // erase area
    page.drawRectangle({
      x: t.x,
      y: page.getHeight() - t.y,
      width: t.text.length * t.size * 0.6,
      height: t.size + 6,
      color: rgb(1, 1, 1)
    });

    // draw text
    const r = parseInt(t.color.slice(1, 3), 16) / 255;
    const g = parseInt(t.color.slice(3, 5), 16) / 255;
    const b = parseInt(t.color.slice(5, 7), 16) / 255;

    page.drawText(t.text, {
      x: t.x,
      y: page.getHeight() - t.y,
      size: t.size,
      color: rgb(r, g, b)
    });
  });

  const out = await pdfDoc.save();
  fs.unlinkSync(req.file.path);

  res.setHeader("Content-Type", "application/pdf");
  res.send(Buffer.from(out));
});


app.listen(PORT, () => {
  console.log("✅ Server running on http://localhost:5000");
});