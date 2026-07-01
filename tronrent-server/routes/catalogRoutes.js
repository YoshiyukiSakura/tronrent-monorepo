"use strict";

const express = require("express");
const {
  listDirectPayEnergyPlans,
  listEnergyPlans,
} = require("../config/plans");

const router = express.Router();

router.get("/plans", (req, res) => {
  res.status(200).json({
    success: true,
    data: listEnergyPlans(),
  });
});

router.get("/direct-pay-energy", (req, res) => {
  res.status(200).json({
    success: true,
    data: listDirectPayEnergyPlans(),
  });
});

module.exports = router;
