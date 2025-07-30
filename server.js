const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const bodyParser = require("body-parser");
const Feedback = require("./models/Feedback");
const bcrypt = require("bcrypt");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const User = require("./models/User");
require("dotenv").config();

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 }
}));

app.set("view engine", "ejs");

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Authentication middleware
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect("/login");
}

// Routes
app.get("/", (req, res) => {
  res.render("index");
});

// Submit feedback
app.post("/submit", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    const userId = req.session.userId || null;

    const newFeedback = new Feedback({
      name,
      email,
      message,
      submittedBy: userId
    });

    await newFeedback.save();
    res.send("<h2>Thank you for your feedback!</h2><a href='/'>Go Back</a>");
  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong.");
  }
});

// Registration
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  const existing = await User.findOne({ username });
  if (existing) return res.send("Username already exists");

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = new User({ username, email, password: hashedPassword });
  await newUser.save();

  res.send("Registration successful. <a href='/login'>Login</a>");
});


// Login
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.send("Invalid credentials");

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.send("Invalid credentials");

  req.session.userId = user._id;
  res.redirect("/dashboard");
});

// Admin: View All Feedbacks
app.get("/admin/feedbacks", isAuthenticated, async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 }).populate('submittedBy', 'username');
    const successMessage = req.session.success;
    req.session.success = null;
    res.render("feedbacks", { feedbacks, successMessage });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching feedbacks.");
  }
});

// Edit feedback
app.get("/feedbacks/:id/edit", isAuthenticated, async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    if (!feedback) return res.status(404).send("Feedback not found");
    res.render("edit-feedback", { feedback });
  } catch (err) {
    res.status(500).send("Server error");
  }
});

// Update feedback
app.post("/feedbacks/:id/update", isAuthenticated, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    await Feedback.findByIdAndUpdate(req.params.id, { name, email, message });
    req.session.success = "Feedback updated successfully!";
    res.redirect("/admin/feedbacks");
  } catch (err) {
    res.status(500).send("Failed to update feedback.");
  }
});

// Delete feedback
app.post("/feedbacks/:id/delete", isAuthenticated, async (req, res) => {
  try {
    await Feedback.findByIdAndDelete(req.params.id);
    req.session.success = "Feedback deleted successfully!";
    res.redirect("/admin/feedbacks");
  } catch (err) {
    res.status(500).send("Failed to delete feedback.");
  }
});

// Dashboard
app.get("/dashboard", requireLogin, async (req, res) => {
  const search = req.query.search || "";
  const query = {
    $or: [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } }
    ]
  };

  const feedbacks = await Feedback.find(query).sort({ submittedAt: -1 });

  const feedbackCountsMap = {};
  feedbacks.forEach(fb => {
    const date = fb.submittedAt.toISOString().split('T')[0];
    feedbackCountsMap[date] = (feedbackCountsMap[date] || 0) + 1;
  });

  const labels = Object.keys(feedbackCountsMap).sort();
  const counts = labels.map(date => feedbackCountsMap[date]);

  res.render("dashboard", {
    feedbacks,
    feedbackCounts: { labels, counts },
    search
  });
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
