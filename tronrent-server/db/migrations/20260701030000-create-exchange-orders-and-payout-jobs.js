"use strict";

const ACTIVE_EXCHANGE_INPUT_INDEX = "exchange_orders_active_input_identity_unique";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "exchange_orders",
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
          quoteId: {
            type: Sequelize.UUID,
            allowNull: false,
            unique: true,
            references: {
              model: "exchange_quotes",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "RESTRICT",
          },
          direction: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          customerWalletAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          outputAddress: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          treasuryAddress: {
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
          inputContractAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          outputContractAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          inputDecimals: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          outputDecimals: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          quoteInputAmount: {
            type: Sequelize.DECIMAL(30, 6),
            allowNull: false,
          },
          quoteOutputAmount: {
            type: Sequelize.DECIMAL(30, 6),
            allowNull: false,
          },
          expectedInputBaseUnits: {
            type: Sequelize.BIGINT,
            allowNull: false,
          },
          baseInputBaseUnits: {
            type: Sequelize.BIGINT,
            allowNull: false,
          },
          inputOffsetBaseUnits: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          outputBaseUnits: {
            type: Sequelize.BIGINT,
            allowNull: false,
          },
          spreadBps: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          rate: {
            type: Sequelize.DECIMAL(30, 12),
            allowNull: false,
          },
          depositReference: {
            type: Sequelize.STRING,
            allowNull: false,
            unique: true,
          },
          expiresAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          fundsReceivedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          payoutCompletedAt: {
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
        "exchange_payout_jobs",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          exchangeOrderId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "exchange_orders",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
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
          asset: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          contractAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          toAddress: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          amountBaseUnits: {
            type: Sequelize.BIGINT,
            allowNull: false,
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

      await queryInterface.addColumn(
        "chain_deposits",
        "matchedExchangeOrderId",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "exchange_orders",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        { transaction }
      );
      await queryInterface.addColumn(
        "chain_deposits",
        "matchedExchangePayoutJobId",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "exchange_payout_jobs",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        { transaction }
      );

      await queryInterface.addIndex("exchange_orders", ["status"], {
        transaction,
      });
      await queryInterface.addIndex("exchange_orders", ["quoteId"], {
        transaction,
        unique: true,
      });
      await queryInterface.addIndex("exchange_orders", ["idempotencyKey"], {
        transaction,
        unique: true,
      });
      await queryInterface.addIndex("exchange_orders", ["depositReference"], {
        transaction,
        unique: true,
      });
      await queryInterface.addIndex("exchange_payout_jobs", ["exchangeOrderId"], {
        transaction,
      });
      await queryInterface.addIndex("exchange_payout_jobs", ["status"], {
        transaction,
      });
      await queryInterface.addIndex("chain_deposits", ["matchedExchangeOrderId"], {
        transaction,
      });
      await queryInterface.addIndex(
        "chain_deposits",
        ["matchedExchangePayoutJobId"],
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          CREATE UNIQUE INDEX "${ACTIVE_EXCHANGE_INPUT_INDEX}"
          ON "exchange_orders" (
            "treasuryAddress",
            "inputAsset",
            COALESCE("inputContractAddress", 'native'),
            "expectedInputBaseUnits"
          )
          WHERE "status" = 'pending_deposit'
        `,
        { transaction }
      );
    });
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS "${ACTIVE_EXCHANGE_INPUT_INDEX}"`,
        { transaction }
      );
      await queryInterface.removeColumn(
        "chain_deposits",
        "matchedExchangePayoutJobId",
        { transaction }
      );
      await queryInterface.removeColumn(
        "chain_deposits",
        "matchedExchangeOrderId",
        { transaction }
      );
      await queryInterface.dropTable("exchange_payout_jobs", { transaction });
      await queryInterface.dropTable("exchange_orders", { transaction });
    });
  },
};
