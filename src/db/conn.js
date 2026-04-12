const mongoose = require("mongoose");

mongoose.connect(process.env.MONGODB_URI)
.then(() => {
    console.log("Connection successful");
})
.catch((e) => {
    console.log("No connection happened", e);
});