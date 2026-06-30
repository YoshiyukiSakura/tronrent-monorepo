"use strict";

module.exports = (sequelize, DataTypes) => {
  const ExchangeQuote = sequelize.define(
    "ExchangeQuote",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      direction: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      inputAsset: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      outputAsset: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      inputAmount: {
        type: DataTypes.DECIMAL(30, 6),
        allowNull: false,
      },
      outputAmount: {
        type: DataTypes.DECIMAL(30, 6),
        allowNull: false,
      },
      spreadBps: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      tableName: "exchange_quotes",
      timestamps: true,
    }
  );

  ExchangeQuote.associate = (models) => {
    ExchangeQuote.hasOne(models.ExchangeOrder, {
      foreignKey: "quoteId",
      as: "exchangeOrder",
    });
  };

  return ExchangeQuote;
};
