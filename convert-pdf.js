const markdownpdf = require("markdown-pdf");

markdownpdf().from("Customer_Manual.md").to("Fleetly_Customer_Manual.pdf", function () {
  console.log("Created Fleetly_Customer_Manual.pdf");
});
