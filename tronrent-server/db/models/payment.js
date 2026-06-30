"use strict";

module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    "Payment",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      orderId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      method: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      asset: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "TRX",
      },
      expectedAmountSun: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      receivedAmountSun: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      txHash: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      fromAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      toAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      detectedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      confirmedAt: {
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
      tableName: "payments",
      timestamps: true,
    }
  );

  Payment.associate = (models) => {
    Payment.belongsTo(models.Order, {
      foreignKey: "orderId",
      as: "order",
    });
    Payment.hasMany(models.ChainDeposit, {
      foreignKey: "matchedPaymentId",
      as: "chainDeposits",
    });
  };

  return Payment;
};
