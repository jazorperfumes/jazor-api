import { Router } from "express";
import * as ctrl from "../controllers/adminController.js";
import * as claimCtrl from "../controllers/refundClaimsController.js";
import * as pickupCtrl from "../controllers/adminPickupAddressesController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { productImageUpload, productCsvUpload } from "../middleware/upload.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

// dashboard
adminRouter.get("/dashboard", asyncHandler(ctrl.dashboard));

// products
adminRouter.get("/products", asyncHandler(ctrl.productsList));
adminRouter.post("/products", asyncHandler(ctrl.productsCreate));
adminRouter.get("/products/import/template.csv", asyncHandler(ctrl.productsImportTemplate));
adminRouter.post(
  "/products/import/preview",
  productCsvUpload("file"),
  asyncHandler(ctrl.productsImportPreview),
);
adminRouter.post(
  "/products/import/validate",
  asyncHandler(ctrl.productsImportValidateRow),
);
adminRouter.post(
  "/products/import/row",
  asyncHandler(ctrl.productsImportApplyRow),
);
adminRouter.get("/products/:id", asyncHandler(ctrl.productsGet));
adminRouter.patch("/products/:id", asyncHandler(ctrl.productsPatch));
adminRouter.delete("/products/:id", asyncHandler(ctrl.productsDelete));
adminRouter.post("/products/:id/restore", asyncHandler(ctrl.productsRestore));

// variants
adminRouter.post("/products/:id/variants", asyncHandler(ctrl.variantCreate));
adminRouter.patch("/variants/:id", asyncHandler(ctrl.variantPatch));
adminRouter.delete("/variants/:id", asyncHandler(ctrl.variantDelete));

// inventory
adminRouter.get("/inventory", asyncHandler(ctrl.inventoryList));
adminRouter.post("/inventory/:id/adjust", asyncHandler(ctrl.inventoryAdjust));

// images
adminRouter.post(
  "/products/:id/images",
  productImageUpload("file"),
  asyncHandler(ctrl.imagesUpload),
);
adminRouter.patch("/images/:id", asyncHandler(ctrl.imageUpdate));
adminRouter.delete("/images/:id", asyncHandler(ctrl.imageDelete));

// orders
adminRouter.get("/orders", asyncHandler(ctrl.ordersList));
adminRouter.get("/orders/:id", asyncHandler(ctrl.ordersGet));
adminRouter.post("/orders/:id/status", asyncHandler(ctrl.ordersSetStatus));
adminRouter.post("/orders/:id/ship", asyncHandler(ctrl.ordersShip));
adminRouter.post("/orders/:id/ship/rate-shop", asyncHandler(ctrl.ordersRateShop));
adminRouter.post("/orders/:id/ship/live", asyncHandler(ctrl.ordersShipLive));
adminRouter.post("/shipments/:id/cancel", asyncHandler(ctrl.shipmentCancel));

// pickup addresses (provider warehouses)
adminRouter.get("/pickup-addresses", asyncHandler(pickupCtrl.list));
adminRouter.post("/pickup-addresses", asyncHandler(pickupCtrl.create));
adminRouter.get("/pickup-addresses/:id", asyncHandler(pickupCtrl.get));
adminRouter.patch("/pickup-addresses/:id", asyncHandler(pickupCtrl.patch));
adminRouter.delete("/pickup-addresses/:id", asyncHandler(pickupCtrl.remove));

// refund claims
adminRouter.get("/refund-claims", asyncHandler(claimCtrl.adminList));
adminRouter.get("/refund-claims/:id", asyncHandler(claimCtrl.adminDetail));
adminRouter.post("/refund-claims/:id/approve", asyncHandler(claimCtrl.adminApprove));
adminRouter.post("/refund-claims/:id/reject", asyncHandler(claimCtrl.adminReject));

// promotions
adminRouter.get("/promotions", asyncHandler(ctrl.promotionsList));
adminRouter.get("/promotions/gift-options", asyncHandler(ctrl.promotionsGiftOptions));
adminRouter.post("/promotions", asyncHandler(ctrl.promotionsCreate));
adminRouter.patch("/promotions/:id", asyncHandler(ctrl.promotionsPatch));
adminRouter.delete("/promotions/:id", asyncHandler(ctrl.promotionsDeactivate));

// customers
adminRouter.get("/customers", asyncHandler(ctrl.customersList));
adminRouter.get("/customers/:id", asyncHandler(ctrl.customersGet));

// reviews
adminRouter.get("/reviews", asyncHandler(ctrl.reviewsList));
adminRouter.delete("/reviews/:id", asyncHandler(ctrl.reviewsDelete));
adminRouter.post("/reviews/:id/reply", asyncHandler(ctrl.reviewsReply));

// messages
adminRouter.get("/messages", asyncHandler(ctrl.messagesList));
adminRouter.patch("/messages/:id", asyncHandler(ctrl.messagesSetStatus));

// newsletter
adminRouter.get("/newsletter", asyncHandler(ctrl.newsletterList));
adminRouter.get("/newsletter/export.csv", asyncHandler(ctrl.newsletterExport));
