"use strict";

const express = require("express");
const { listEnergyPlans } = require("../config/plans");

const router = express.Router();

router.get("/plans", (req, res) => {
  res.status(200).json({
    success: true,
    data: listEnergyPlans(),
  });
});

module.exports = router;
