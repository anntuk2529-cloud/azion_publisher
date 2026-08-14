require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "azion_publisher"
  });
});

app.post("/publish", async (req, res) => {
  try {
    const { siteName, html } = req.body;

    if (!siteName || !html) {
      return res.status(400).json({
        error: "siteName e html são obrigatórios"
      });
    }

    return res.json({
      success: true,
      siteName
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("azion_publisher iniciado");
});
