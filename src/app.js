require("dotenv").config();
const winston = require('winston');

// Configure Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});
const express = require("express");
const client = require("prom-client");
const path = require("path");
const exphbs = require('express-handlebars');
const session = require('express-session');
const Register = require("./models/registers");
const Booking = require("./models/booking"); // Require the booking model
const app = express();
// Prometheus metrics setup
const register = new client.Registry();

// collect default system metrics
client.collectDefaultMetrics({ register });

// custom metric
const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
});

register.registerMetric(httpRequests);
const hbs = require("hbs");
require("./db/conn");

const port = process.env.PORT || 3000;
const static_path = path.join(__dirname, "../public");
const template_path = path.join(__dirname, "../templates/views");
const partials_path = path.join(__dirname, "../templates/partials");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(static_path));
app.use((req, res, next) => {
  httpRequests.inc();
  next();
});


app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));

app.set("view engine", "hbs")
app.set("views", template_path)
hbs.registerPartials(partials_path);

app.get("/", (req, res) => {
    res.render("index")
});

app.get("/login", (req, res) => {
    res.render("login")
});

app.get("/register", (req, res) => {
    res.render("register")
});

app.get("/partner", (req, res) => {
    res.render("partner")
});

app.get("/booking-summary", (req, res) => {
    res.render("order-summary")
});
app.get("/order-success",(req,res)=>{
    res.render("order-success")
})
app.get("/contact",(req,res)=>{
    res.render("contact")
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error("Error destroying session:", { error: err.message || err });
            return res.status(500).send("Error logging out");
        }
        res.redirect("/");
    });
});

app.get("/profile", async (req, res) => {
    try {
        // Retrieve user's email from session
        const userEmail = req.session.userEmail;
        if (!userEmail) {
            return res.status(404).send("User not found");
        }

        // Find user in the database based on the email
        const user = await Register.findOne({ email: userEmail });
        if (!user) {
            return res.status(404).send("User not found");
        }
        const bookings = await Booking.find({ userEmail: userEmail });
        // Render profile page with user data
        res.render("profile", { userData: user,bookings:bookings });
    } catch (error) {
        logger.error("Error fetching user data:", { error: error.message || error });
        res.status(500).send("Internal Server Error");
    }
});

app.post("/register", async (req, res) => {
    try {
        const password = req.body.password;
        const cpassword = req.body.confirmpassword;
        
        if (password === cpassword) {
            const registerUser = new Register({
                email: req.body.email,
                password: password,
                confirmpassword: cpassword,
                mobile: req.body.mobile
            });

            const registered = await registerUser.save();
            logger.info("User registered:", { email: registered.email });

            // Store user's email in session
            req.session.userEmail = req.body.email;

            // Redirect to profile page after successful registration
            res.status(201).redirect("/");
        } else {
            logger.warn("Registration failed: Passwords do not match", { email: req.body.email });
            res.send("Passwords do not match");
        }
    } catch (error) {
        logger.error("Error during registration:", { error: error.message || error });
        res.status(400).send(error);
    }
});

app.post("/login", async (req, res) => {
    try {
        const email = req.body.email;
        const password = req.body.password;
        logger.info("Login attempt:", { email });

        // Find user in the database based on the email
        const user = await Register.findOne({ email: email });

        // If user does not exist, return error
        if (!user) {
            return res.status(404).send("User not found");
        }

        // Check if the entered password matches the stored password
        if (user.password === password) {
            // Store user's email in session
            req.session.userEmail = email;

            // Redirect to index page after successful login
            return res.status(201).redirect("/");
        } else {
            return res.status(401).send("Passwords do not match");
        }

    } catch (error) {
        logger.error("Error during login:", { error: error.message || error });
        res.status(500).send("Internal Server Error");
    }
});


// Define the price per luggage item
const PRICE_PER_LUGGAGE = 10; 

// POST route for handling the form submission
app.post('/booking-summary', async (req, res) => {
    try {
        // Extract data from the request body
        const { location, checkInDate, checkOutDate, luggageItems } = req.body;

        // Validate required fields
        if (!checkInDate || !checkOutDate || !luggageItems) {
            return res.status(400).send("Please fill in all booking fields (check-in date, check-out date, and luggage items).");
        }

        // Calculate the number of days between check-in and check-out dates
        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);
        const numberOfDays = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

        if (numberOfDays <= 0) {
            return res.status(400).send("Check-out date must be after check-in date.");
        }

        // Calculate the total price
        const totalPrice = numberOfDays * parseInt(luggageItems) * PRICE_PER_LUGGAGE;

        // Get the user's email from the session
        const userEmail = req.session.userEmail;

        if (!userEmail) {
            logger.info("Booking attempt by unauthenticated user, redirecting to login");
            return res.redirect('/login');
        }

        // Create a new booking document
        const booking = new Booking({
            userEmail,
            location,
            checkInDate,
            checkOutDate,
            luggageItems,
            totalPrice
        });

        // Save the booking document to the database
        await booking.save();
        const user = await Register.findOne({ email: userEmail });

        // Push the booking details into the user's profile
        user.bookings.push(booking);
        await user.save();

        // Render the order-summary template with the data
        res.render('booking-summary', { 
            orderSummary: {
                location,
                checkInDate,
                checkOutDate,
                luggageItems,
            },
            numberOfDays,
            totalPrice
        });
    } catch (error) {
        logger.error("Error saving booking:", { error: error.message || error });
        res.status(500).send("Internal Server Error");
    }
});


app.post('/checkout', async (req, res) => {
    res.redirect('/order-success');
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(port, () => {
    logger.info(`server is running at port no ${port}`);
});

module.exports = app;