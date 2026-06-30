"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "orders",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          idempotencyKey: {
            type: Sequelize.STRING,
            allowNull: false,
            unique: true,
          },
          planId: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          targetAddress: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          customerWalletAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          paymentMethod: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          paymentAsset: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "TRX",
          },
          priceAmountSun: {
            type: Sequelize.BIGINT,
            allowNull: false,
          },
          energyAmount: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          durationHours: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          treasuryAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          depositAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          paymentReference: {
            type: Sequelize.STRING,
            allowNull: false,
            unique: true,
          },
          expiresAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          paidAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          provisionedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          fulfilledAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
        },
        { transaction }
      );

      await queryInterface.createTable(
        "payments",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          orderId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "orders",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
          },
          method: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          asset: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "TRX",
          },
          expectedAmountSun: {
            type: Sequelize.BIGINT,
            allowNull: false,
          },
          receivedAmountSun: {
            type: Sequelize.BIGINT,
            allowNull: true,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          txHash: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          fromAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          toAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          detectedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          confirmedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
        },
        { transaction }
      );

      await queryInterface.createTable(
        "provider_jobs",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          orderId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "orders",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
          },
          provider: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          action: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          dryRun: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          request: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          response: {
            type: Sequelize.JSONB,
            allowNull: true,
          },
          attemptCount: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          lastError: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          processedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
        },
        { transaction }
      );

      await queryInterface.createTable(
        "exchange_quotes",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          direction: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          inputAsset: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          outputAsset: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          inputAmount: {
            type: Sequelize.DECIMAL(30, 6),
            allowNull: false,
          },
          outputAmount: {
            type: Sequelize.DECIMAL(30, 6),
            allowNull: false,
          },
          spreadBps: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          expiresAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn("now"),
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("orders", ["status"], { transaction });
      await queryInterface.addIndex("orders", ["targetAddress"], { transaction });
      await queryInterface.addIndex("orders", ["paymentReference"], {
        transaction,
        unique: true,
      });
      await queryInterface.addIndex("payments", ["orderId"], { transaction });
      await queryInterface.addIndex("payments", ["status"], { transaction });
      await queryInterface.addIndex("payments", ["txHash"], { transaction });
      await queryInterface.addIndex("provider_jobs", ["orderId"], {
        transaction,
      });
      await queryInterface.addIndex("provider_jobs", ["status"], {
        transaction,
      });
      await queryInterface.addIndex("exchange_quotes", ["direction"], {
        transaction,
      });
      await queryInterface.addIndex("exchange_quotes", ["status"], {
        transaction,
      });
    });
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("exchange_quotes", { transaction });
      await queryInterface.dropTable("provider_jobs", { transaction });
      await queryInterface.dropTable("payments", { transaction });
      await queryInterface.dropTable("orders", { transaction });
    });
  },
};
