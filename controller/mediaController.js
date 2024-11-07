const path = require("path");
const fs = require("fs");
module.exports.getMedia = async (req, res) => {
  try {
    const mediaName = req.params.name;
    const category = mediaName.split("_")[0];
    const dirMain = process.cwd();
    const filePath = path.resolve(dirMain, category, mediaName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res
            .status(416)
            .send(
              "Requested range not satisfiable\n" + start + " >= " + fileSize
            );
          return;
        }

        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          // "Content-Type": mimeType,
        };

        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          "Content-Length": fileSize,
          // "Content-Type": mimeType,
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
    } else {
      res.status(404).send("Media not found");
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
