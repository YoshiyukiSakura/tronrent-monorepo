"use strict";

module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    "Order",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      idempotencyKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      planId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      targetAddress: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      customerWalletAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      paymentMethod: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      paymentAsset: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "TRX",
      },
      priceAmountSun: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      basePriceAmountSun: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      priceOffsetSun: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      energyAmount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      durationHours: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      treasuryAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      depositAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      paymentReference: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      provisionedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      fulfilledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "orders",
      timestamps: true,
    }
  );

  Order.associate = (models) => {
    Order.hasMany(models.Payment, {
      foreignKey: "orderId",
      as: "payments",
    });
    Order.hasMany(models.ProviderJob, {
      foreignKey: "orderId",
      as: "providerJobs",
    });
    Order.hasMany(models.ChainDeposit, {
      foreignKey: "matchedOrderId",
      as: "chainDeposits",
    });
  };

  return Order;
};
