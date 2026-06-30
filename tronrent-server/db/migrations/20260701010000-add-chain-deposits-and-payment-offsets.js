"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "orders",
        "basePriceAmountSun",
        {
          type: Sequelize.BIGINT,
          allowNull: false,
          defaultValue: 0,
        },
        { transaction }
      );
      await queryInterface.addColumn(
        "orders",
        "priceOffsetSun",
        {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        'UPDATE "orders" SET "basePriceAmountSun" = "priceAmountSun" WHERE "basePriceAmountSun" = 0',
        { transaction }
      );

      await queryInterface.createTable(
        "chain_deposits",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          depositKey: {
            type: Sequelize.STRING,
            allowNull: false,
            unique: true,
          },
          network: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "tron",
          },
          asset: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          txHash: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          eventIndex: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "0",
          },
          contractAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          tokenDecimals: {
            type: Sequelize.INTEGER,
            allowNull: true,
          },
          tokenSymbol: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          fromAddress: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          toAddress: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          amountBaseUnits: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          blockNumber: {
            type: Sequelize.BIGINT,
            allowNull: true,
          },
          blockTimestamp: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          confirmations: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          matchedOrderId: {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
              model: "orders",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
          },
          matchedPaymentId: {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
              model: "payments",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
          },
          raw: {
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

      await queryInterface.addIndex("orders", ["priceAmountSun"], {
        transaction,
      });
      await queryInterface.addIndex("orders", ["basePriceAmountSun"], {
        transaction,
      });
      await queryInterface.addIndex("payments", ["expectedAmountSun"], {
        transaction,
      });
      await queryInterface.addIndex("chain_deposits", ["depositKey"], {
        transaction,
        unique: true,
      });
      await queryInterface.addIndex("chain_deposits", ["txHash", "eventIndex"], {
        transaction,
      });
      await queryInterface.addIndex("chain_deposits", ["status"], {
        transaction,
      });
      await queryInterface.addIndex("chain_deposits", ["toAddress", "asset"], {
        transaction,
      });
      await queryInterface.addIndex("chain_deposits", ["matchedOrderId"], {
        transaction,
      });
      await queryInterface.addIndex("chain_deposits", ["matchedPaymentId"], {
        transaction,
      });
    });
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("chain_deposits", { transaction });
      await queryInterface.removeIndex("payments", ["expectedAmountSun"], {
        transaction,
      });
      await queryInterface.removeIndex("orders", ["basePriceAmountSun"], {
        transaction,
      });
      await queryInterface.removeIndex("orders", ["priceAmountSun"], {
        transaction,
      });
      await queryInterface.removeColumn("orders", "priceOffsetSun", {
        transaction,
      });
      await queryInterface.removeColumn("orders", "basePriceAmountSun", {
        transaction,
      });
    });
  },
};
