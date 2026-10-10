-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'DOCUMENTS_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('SALARIED', 'COMMISSION', 'JOB_BASED', 'PARTNER');

-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "VehicleClass" AS ENUM ('TWO_WHEELER', 'HATCHBACK', 'SEDAN', 'SUV', 'PREMIUM', 'LCV', 'HCV');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('TOWING', 'ONSITE');

-- CreateEnum
CREATE TYPE "TruckType" AS ENUM ('FLATBED', 'WHEEL_LIFT', 'HEAVY_DUTY', 'BIKE_CARRIER', 'SERVICE_VAN');

-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('WINCH', 'DOLLIES', 'GO_JACKS', 'WHEEL_SKATES', 'WHEEL_LIFT', 'FLATBED_DECK', 'JUMP_STARTER', 'TYRE_KIT', 'FUEL_CAN', 'LOCKOUT_KIT', 'EV_SAFE_KIT', 'RECOVERY_STRAPS', 'SAFETY_CONES');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('OK', 'DAMAGED', 'MISSING');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'BUSY', 'ON_JOB', 'ON_BREAK', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('REQUESTED', 'QUOTED', 'CONFIRMED', 'SEARCHING_FOR_PROVIDER', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'RECOVERY_AUTHORIZED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'REJECTED', 'REASSIGNMENT_REQUIRED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'SAFETY_HOLD', 'DISPUTED');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('EMERGENCY', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "BookingPriority" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('PICKUP', 'DROPOFF');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'MAP_PIN', 'MANUAL', 'LINK', 'SAVED');

-- CreateEnum
CREATE TYPE "DestinationType" AS ENUM ('GARAGE', 'SERVICE_CENTRE', 'HOME', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TriState" AS ENUM ('YES', 'NO', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "BreakdownType" AS ENUM ('MECHANICAL', 'COLLISION', 'ENGINE', 'BATTERY', 'TYRE', 'TRANSMISSION', 'FLOOD', 'FUEL', 'LOCKOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "AccessRestriction" AS ENUM ('NONE', 'BASEMENT', 'NARROW_LANE', 'PARKING_STRUCTURE', 'RESTRICTED_AREA');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('DAMAGE_PHOTO', 'DAMAGE_VIDEO', 'PICKUP_EVIDENCE', 'DELIVERY_EVIDENCE', 'TOLL_RECEIPT', 'INCIDENT', 'VEHICLE_PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteKind" AS ENUM ('INITIAL', 'REVISION');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING_INTERNAL_APPROVAL', 'PENDING_CUSTOMER_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT', 'CANCELLED', 'RELEASED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentMethod" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('TEAM_LEADER', 'DRIVER', 'RECOVERY_WORKER');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('CUSTOMER', 'DRIVER', 'WORKER', 'DISPATCHER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConditionStage" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "CustodyStage" AS ENUM ('PICKUP', 'HANDOVER');

-- CreateEnum
CREATE TYPE "CustodyMethod" AS ENUM ('OTP', 'AUTHORIZED_OVERRIDE');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SERVICE', 'CANCELLATION', 'MEMBERSHIP');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'PAYMENT_FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'CASH', 'BANK_TRANSFER', 'PREPAID_CREDIT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'SANDBOX', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'MAINTENANCE', 'REPAIR', 'EQUIPMENT', 'RENTAL', 'MARKETING', 'INSURANCE', 'TOLLS_PARKING', 'OFFICE', 'SOFTWARE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('DIRECT', 'VENDOR_BILL', 'EMPLOYEE_CLAIM');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "SalaryStatus" AS ENUM ('ACCRUED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('JOB_FIXED', 'JOB_COMMISSION', 'INCENTIVE', 'DEDUCTION', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'IN_PAYOUT', 'VOID');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('WRITE_OFF', 'ROUNDING', 'CORRECTION');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL', 'COMPLAINT', 'BILLING_DISPUTE', 'REFUND_REQUEST', 'PRIVACY_REQUEST', 'PERFORMANCE_CHALLENGE', 'SAFETY');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('UNSAFE_LOCATION', 'ACCIDENT', 'EQUIPMENT_DAMAGE', 'DISPUTE', 'CUSTOMER_UNAVAILABLE', 'INJURY', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EscalationType" AS ENUM ('DRIVER_REJECTED', 'DRIVER_NO_RESPONSE', 'MISSED_ETA', 'VEHICLE_UNAVAILABLE', 'LOCATION_STALE', 'CUSTOMER_CANNOT_CONTACT', 'NO_PROVIDER', 'SAFETY', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ID_PROOF', 'DRIVING_LICENCE', 'PHOTO', 'ADDRESS_PROOF', 'TRAINING_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('SERVICE', 'REPAIR', 'INSPECTION', 'BREAKDOWN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "photoKey" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "termsAcceptedAt" TIMESTAMP(3),
    "privacyConsentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "locationConsent" BOOLEAN NOT NULL DEFAULT false,
    "notifySms" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "landmark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "fleetAccountId" TEXT,
    "vehicleClass" "VehicleClass" NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "fuelType" "FuelType" NOT NULL,
    "color" TEXT,
    "year" INTEGER,
    "photoKeys" TEXT[],
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "partnerCompany" TEXT,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'SALARIED',
    "payFrequency" "PayFrequency",
    "baseSalary" INTEGER,
    "commissionBps" INTEGER,
    "perJobAmount" INTEGER,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verificationNote" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "skills" TEXT[],
    "trainingNotes" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "payoutMethod" TEXT,
    "payoutDetailsMasked" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenceNumberMask" TEXT NOT NULL,
    "licenceClass" TEXT NOT NULL,
    "licenceExpiry" TIMESTAMP(3) NOT NULL,
    "canLeadTeam" BOOLEAN NOT NULL DEFAULT true,
    "heavyVehicleCert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "numberMasked" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_availability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'OFF_DUTY',
    "zoneId" TEXT,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastAccuracyM" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "locationSharing" BOOLEAN NOT NULL DEFAULT false,
    "statusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AvailabilityStatus" NOT NULL,
    "zoneId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "availability_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tow_trucks" (
    "id" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "truckType" "TruckType" NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "maxLoadKg" INTEGER NOT NULL,
    "maxVehicleClass" "VehicleClass" NOT NULL,
    "status" "TruckStatus" NOT NULL DEFAULT 'AVAILABLE',
    "zoneId" TEXT,
    "assignedDriverUserId" TEXT,
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "lastServiceAt" TIMESTAMP(3),
    "lastServiceOdometerKm" INTEGER,
    "serviceIntervalKm" INTEGER NOT NULL DEFAULT 10000,
    "serviceIntervalDays" INTEGER NOT NULL DEFAULT 180,
    "insuranceExpiry" TIMESTAMP(3),
    "fitnessExpiry" TIMESTAMP(3),
    "permitExpiry" TIMESTAMP(3),
    "pucExpiry" TIMESTAMP(3),
    "nextInspectionDue" TIMESTAMP(3),
    "notes" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tow_trucks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "truck_equipment" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "type" "EquipmentType" NOT NULL,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'OK',
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "truck_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "odometerKm" INTEGER,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "expenseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "polygon" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "allowedTruckTypes" "TruckType"[],
    "requiredEquipment" "EquipmentType"[],
    "vehicleClasses" "VehicleClass"[],
    "defaultCrew" INTEGER NOT NULL DEFAULT 1,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_zone_categories" (
    "zoneId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_zone_categories_pkey" PRIMARY KEY ("zoneId","categoryId")
);

-- CreateTable
CREATE TABLE "rate_cards" (
    "id" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "zoneId" TEXT,
    "vehicleClass" "VehicleClass",
    "fleetContractId" TEXT,
    "baseFee" INTEGER NOT NULL,
    "includedKm" DOUBLE PRECISION NOT NULL,
    "perKm" INTEGER NOT NULL,
    "pickupFreeKm" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "pickupPerKm" INTEGER NOT NULL DEFAULT 0,
    "includedCrew" INTEGER NOT NULL DEFAULT 1,
    "crewChargePerWorker" INTEGER NOT NULL DEFAULT 0,
    "waitingFreeMinutes" INTEGER NOT NULL DEFAULT 15,
    "waitingPer15Min" INTEGER NOT NULL DEFAULT 0,
    "nightSurchargeBps" INTEGER NOT NULL DEFAULT 0,
    "nightStartHour" INTEGER NOT NULL DEFAULT 22,
    "nightEndHour" INTEGER NOT NULL DEFAULT 6,
    "holidaySurchargeBps" INTEGER NOT NULL DEFAULT 0,
    "minimumCharge" INTEGER NOT NULL DEFAULT 0,
    "scheduledBookingFee" INTEGER NOT NULL DEFAULT 0,
    "equipmentSurcharges" JSONB NOT NULL DEFAULT '{}',
    "taxRateBps" INTEGER NOT NULL DEFAULT 1800,
    "tollTreatment" TEXT NOT NULL DEFAULT 'PASS_THROUGH_ACTUALS',
    "quoteValidityMin" INTEGER NOT NULL DEFAULT 30,
    "cancellationPolicy" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "maxDiscount" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerUserId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "fleetAccountId" TEXT,
    "serviceCategoryId" TEXT NOT NULL,
    "zoneId" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "type" "BookingType" NOT NULL DEFAULT 'EMERGENCY',
    "scheduledFor" TIMESTAMP(3),
    "priority" "BookingPriority" NOT NULL DEFAULT 'NORMAL',
    "safetyFlags" TEXT[],
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT false,
    "manualReviewReasons" TEXT[],
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "recommendation" JSONB,
    "crewRequested" INTEGER NOT NULL DEFAULT 1,
    "crewRecommended" INTEGER NOT NULL DEFAULT 1,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "instructions" TEXT,
    "promoCode" TEXT,
    "membershipSubscriptionId" TEXT,
    "pickupOtp" TEXT NOT NULL,
    "handoverOtp" TEXT NOT NULL,
    "pickupVerifiedAt" TIMESTAMP(3),
    "pickupDistanceKm" DOUBLE PRECISION,
    "towDistanceKm" DOUBLE PRECISION,
    "distanceSource" TEXT,
    "etaAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "waitingMinutes" INTEGER NOT NULL DEFAULT 0,
    "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
    "cancellationReason" TEXT,
    "cancellationFee" INTEGER NOT NULL DEFAULT 0,
    "cancelledById" TEXT,
    "failureReason" TEXT,
    "holdReturnStatus" "BookingStatus",
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_locations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "source" "LocationSource" NOT NULL,
    "address" TEXT,
    "landmark" TEXT,
    "highway" TEXT,
    "roadDirection" TEXT,
    "kmMarker" TEXT,
    "gateNumber" TEXT,
    "floor" TEXT,
    "parkingLevel" TEXT,
    "accessNotes" TEXT,
    "isSafeLocation" BOOLEAN,
    "destinationType" "DestinationType",
    "placeName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_vehicle_assessments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "breakdownType" "BreakdownType" NOT NULL,
    "engineStarts" "TriState" NOT NULL,
    "wheelsRotate" "TriState" NOT NULL,
    "steeringWorks" "TriState" NOT NULL,
    "brakesWork" "TriState" NOT NULL,
    "isStuck" "TriState" NOT NULL,
    "isOverturned" "TriState" NOT NULL,
    "isSubmerged" "TriState" NOT NULL,
    "blockingTraffic" "TriState" NOT NULL,
    "majorDamage" "TriState" NOT NULL,
    "isEvOrHybrid" BOOLEAN NOT NULL DEFAULT false,
    "accessRestriction" "AccessRestriction" NOT NULL DEFAULT 'NONE',
    "hasChildren" BOOLEAN NOT NULL DEFAULT false,
    "hasElderly" BOOLEAN NOT NULL DEFAULT false,
    "needsAccessibility" BOOLEAN NOT NULL DEFAULT false,
    "passengersNeedingTransport" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_vehicle_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_attachments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_quotes" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "QuoteKind" NOT NULL,
    "status" "QuoteStatus" NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "rateCardVersion" INTEGER NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discountTotal" INTEGER NOT NULL,
    "taxableValue" INTEGER NOT NULL,
    "taxTotal" INTEGER NOT NULL,
    "passThroughTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT,
    "requestedById" TEXT,
    "internalApprovedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isPassThrough" BOOLEAN NOT NULL DEFAULT false,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_assignments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "truckId" TEXT,
    "status" "AssignmentStatus" NOT NULL,
    "method" "AssignmentMethod" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "assignedById" TEXT,
    "etaMinutes" INTEGER,
    "distanceKm" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "scoreBreakdown" JSONB,

    CONSTRAINT "booking_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_team_members" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "responsibility" TEXT,
    "addedById" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "ActorRole" NOT NULL,
    "reason" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "driverUserId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_condition_reports" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stage" "ConditionStage" NOT NULL,
    "reportedById" TEXT NOT NULL,
    "notes" TEXT,
    "damageMarks" JSONB NOT NULL,
    "odometerKm" INTEGER,
    "fuelLevel" TEXT,
    "itemsInVehicle" TEXT,
    "attachmentIds" TEXT[],
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_condition_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_confirmations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "stage" "CustodyStage" NOT NULL,
    "method" "CustodyMethod" NOT NULL,
    "recipientName" TEXT,
    "recipientRelation" TEXT,
    "confirmedById" TEXT NOT NULL,
    "overrideReason" TEXT,
    "overrideApprovedById" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_share_links" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "bookingId" TEXT,
    "subscriptionId" TEXT,
    "customerUserId" TEXT NOT NULL,
    "fleetAccountId" TEXT,
    "approvedQuoteId" TEXT,
    "billingName" TEXT NOT NULL,
    "billingPhone" TEXT,
    "billingEmail" TEXT,
    "billingAddress" TEXT,
    "billingGstin" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" INTEGER NOT NULL,
    "discountTotal" INTEGER NOT NULL,
    "taxableValue" INTEGER NOT NULL,
    "taxTotal" INTEGER NOT NULL,
    "passThroughTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "amountPendingCash" INTEGER NOT NULL DEFAULT 0,
    "amountCredited" INTEGER NOT NULL DEFAULT 0,
    "amountRefunded" INTEGER NOT NULL DEFAULT 0,
    "amountWrittenOff" INTEGER NOT NULL DEFAULT 0,
    "outstanding" INTEGER NOT NULL,
    "approvedQuoteTotal" INTEGER,
    "pricingSnapshot" JSONB,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isPassThrough" BOOLEAN NOT NULL DEFAULT false,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "sourceQuoteId" TEXT,
    "reason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "taxableAmount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentTxnStatus" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "gatewayFee" INTEGER NOT NULL DEFAULT 0,
    "gatewayTax" INTEGER NOT NULL DEFAULT 0,
    "receiptNumber" TEXT,
    "collectedById" TEXT,
    "confirmedById" TEXT,
    "initiatedById" TEXT,
    "failureReason" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "failureReason" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_adjustments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "type" "AdjustmentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "source" "ExpenseSource" NOT NULL DEFAULT 'DIRECT',
    "status" "ExpenseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "description" TEXT NOT NULL,
    "vendorName" TEXT,
    "vendorBillRef" TEXT,
    "amount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "fuelLitres" DOUBLE PRECISION,
    "odometerKm" INTEGER,
    "truckId" TEXT,
    "bookingId" TEXT,
    "zoneId" TEXT,
    "claimantUserId" TEXT,
    "reimbursable" BOOLEAN NOT NULL DEFAULT false,
    "attachmentKey" TEXT,
    "submittedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frequency" "PayFrequency" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "baseAmount" INTEGER NOT NULL,
    "incentives" INTEGER NOT NULL DEFAULT 0,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "status" "SalaryStatus" NOT NULL DEFAULT 'ACCRUED',
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "kind" "EarningKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "payoutId" TEXT,
    "note" TEXT,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payouts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "earningsAmount" INTEGER NOT NULL,
    "incentivesAmount" INTEGER NOT NULL,
    "deductionsAmount" INTEGER NOT NULL,
    "reimbursementsAmount" INTEGER NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "includedServices" INTEGER NOT NULL,
    "includedKmPerService" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "coveredCategoryKeys" TEXT[],
    "exclusions" TEXT NOT NULL,
    "renewalTerms" TEXT NOT NULL,
    "forFleet" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_subscriptions" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "userId" TEXT,
    "fleetAccountId" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "servicesUsed" INTEGER NOT NULL DEFAULT 0,
    "planSnapshot" JSONB NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_usages" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "benefitAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "billingEmail" TEXT NOT NULL,
    "billingPhone" TEXT,
    "billingAddress" TEXT,
    "creditLimit" INTEGER NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_account_members" (
    "fleetAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_account_members_pkey" PRIMARY KEY ("fleetAccountId","userId")
);

-- CreateTable
CREATE TABLE "fleet_contracts" (
    "id" TEXT NOT NULL,
    "fleetAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "slaResponseMinutes" INTEGER,
    "monthlyServiceLimit" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "raterUserId" TEXT NOT NULL,
    "rateeUserId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "subject" TEXT NOT NULL,
    "bookingId" TEXT,
    "invoiceId" TEXT,
    "subjectUserId" TEXT,
    "assignedToId" TEXT,
    "resolution" TEXT,
    "verified" BOOLEAN,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "reportedById" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "EscalationType" NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "dedupeKey" TEXT,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_WorkerZones" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_WorkerZones_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_purpose_createdAt_idx" ON "otp_challenges"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_userId_key" ON "customer_profiles"("userId");

-- CreateIndex
CREATE INDEX "saved_addresses_userId_idx" ON "saved_addresses"("userId");

-- CreateIndex
CREATE INDEX "emergency_contacts_userId_idx" ON "emergency_contacts"("userId");

-- CreateIndex
CREATE INDEX "vehicles_ownerUserId_idx" ON "vehicles"("ownerUserId");

-- CreateIndex
CREATE INDEX "vehicles_registrationNumber_idx" ON "vehicles"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_userId_key" ON "worker_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_employeeCode_key" ON "worker_profiles"("employeeCode");

-- CreateIndex
CREATE INDEX "worker_profiles_verificationStatus_idx" ON "worker_profiles"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");

-- CreateIndex
CREATE INDEX "employee_documents_userId_idx" ON "employee_documents"("userId");

-- CreateIndex
CREATE INDEX "employee_documents_expiresAt_idx" ON "employee_documents"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "driver_availability_userId_key" ON "driver_availability"("userId");

-- CreateIndex
CREATE INDEX "driver_availability_status_zoneId_idx" ON "driver_availability"("status", "zoneId");

-- CreateIndex
CREATE INDEX "availability_logs_userId_startedAt_idx" ON "availability_logs"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tow_trucks_registrationNumber_key" ON "tow_trucks"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tow_trucks_assignedDriverUserId_key" ON "tow_trucks"("assignedDriverUserId");

-- CreateIndex
CREATE INDEX "tow_trucks_status_zoneId_idx" ON "tow_trucks"("status", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "truck_equipment_truckId_type_key" ON "truck_equipment"("truckId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_records_expenseId_key" ON "maintenance_records"("expenseId");

-- CreateIndex
CREATE INDEX "maintenance_records_truckId_performedAt_idx" ON "maintenance_records"("truckId", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_key_key" ON "service_categories"("key");

-- CreateIndex
CREATE INDEX "rate_cards_serviceCategoryId_isActive_idx" ON "rate_cards"("serviceCategoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "rate_cards_lineageId_version_key" ON "rate_cards"("lineageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_customerUserId_createdAt_idx" ON "bookings"("customerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_zoneId_status_idx" ON "bookings"("zoneId", "status");

-- CreateIndex
CREATE INDEX "bookings_createdAt_idx" ON "bookings"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_locations_bookingId_kind_key" ON "booking_locations"("bookingId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "booking_vehicle_assessments_bookingId_key" ON "booking_vehicle_assessments"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_attachments_storageKey_key" ON "booking_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "booking_attachments_bookingId_kind_idx" ON "booking_attachments"("bookingId", "kind");

-- CreateIndex
CREATE INDEX "booking_quotes_bookingId_status_idx" ON "booking_quotes"("bookingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "booking_quotes_bookingId_version_key" ON "booking_quotes"("bookingId", "version");

-- CreateIndex
CREATE INDEX "booking_quote_items_quoteId_idx" ON "booking_quote_items"("quoteId");

-- CreateIndex
CREATE INDEX "booking_assignments_bookingId_idx" ON "booking_assignments"("bookingId");

-- CreateIndex
CREATE INDEX "booking_assignments_driverUserId_status_idx" ON "booking_assignments"("driverUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "booking_team_members_bookingId_userId_key" ON "booking_team_members"("bookingId", "userId");

-- CreateIndex
CREATE INDEX "booking_status_history_bookingId_createdAt_idx" ON "booking_status_history"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "tracking_events_bookingId_recordedAt_idx" ON "tracking_events"("bookingId", "recordedAt");

-- CreateIndex
CREATE INDEX "tracking_events_driverUserId_recordedAt_idx" ON "tracking_events"("driverUserId", "recordedAt");

-- CreateIndex
CREATE INDEX "vehicle_condition_reports_bookingId_stage_idx" ON "vehicle_condition_reports"("bookingId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "custody_confirmations_bookingId_stage_key" ON "custody_confirmations"("bookingId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "booking_share_links_tokenHash_key" ON "booking_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "booking_share_links_bookingId_idx" ON "booking_share_links"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_bookingId_key" ON "invoices"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_subscriptionId_key" ON "invoices"("subscriptionId");

-- CreateIndex
CREATE INDEX "invoices_customerUserId_issuedAt_idx" ON "invoices"("customerUserId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoices_issuedAt_idx" ON "invoices"("issuedAt");

-- CreateIndex
CREATE INDEX "invoices_paymentStatus_idx" ON "invoices"("paymentStatus");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_number_key" ON "credit_notes"("number");

-- CreateIndex
CREATE INDEX "credit_notes_invoiceId_idx" ON "credit_notes"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerOrderId_key" ON "payments"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "payments_invoiceId_status_idx" ON "payments"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "payments_succeededAt_idx" ON "payments"("succeededAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_eventId_key" ON "payment_webhook_events"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerRefundId_key" ON "refunds"("providerRefundId");

-- CreateIndex
CREATE INDEX "refunds_invoiceId_idx" ON "refunds"("invoiceId");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_number_key" ON "expenses"("number");

-- CreateIndex
CREATE INDEX "expenses_expenseDate_idx" ON "expenses"("expenseDate");

-- CreateIndex
CREATE INDEX "expenses_category_status_idx" ON "expenses"("category", "status");

-- CreateIndex
CREATE INDEX "salary_records_periodEnd_idx" ON "salary_records"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "salary_records_userId_periodStart_periodEnd_key" ON "salary_records"("userId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "driver_earnings_userId_earnedAt_idx" ON "driver_earnings"("userId", "earnedAt");

-- CreateIndex
CREATE INDEX "driver_earnings_bookingId_idx" ON "driver_earnings"("bookingId");

-- CreateIndex
CREATE INDEX "driver_payouts_userId_periodEnd_idx" ON "driver_payouts"("userId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_code_key" ON "memberships"("code");

-- CreateIndex
CREATE INDEX "membership_subscriptions_userId_status_idx" ON "membership_subscriptions"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "membership_usages_bookingId_key" ON "membership_usages"("bookingId");

-- CreateIndex
CREATE INDEX "notifications_userId_channel_createdAt_idx" ON "notifications"("userId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "ratings_rateeUserId_idx" ON "ratings"("rateeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_bookingId_raterUserId_rateeUserId_key" ON "ratings"("bookingId", "raterUserId", "rateeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_status_category_idx" ON "support_tickets"("status", "category");

-- CreateIndex
CREATE INDEX "support_tickets_userId_idx" ON "support_tickets"("userId");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_idx" ON "ticket_messages"("ticketId");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "escalations_dedupeKey_key" ON "escalations"("dedupeKey");

-- CreateIndex
CREATE INDEX "escalations_status_createdAt_idx" ON "escalations"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_dedupeKey_key" ON "background_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "background_jobs_status_runAt_idx" ON "background_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "_WorkerZones_B_index" ON "_WorkerZones"("B");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_logs" ADD CONSTRAINT "availability_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tow_trucks" ADD CONSTRAINT "tow_trucks_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tow_trucks" ADD CONSTRAINT "tow_trucks_assignedDriverUserId_fkey" FOREIGN KEY ("assignedDriverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "truck_equipment" ADD CONSTRAINT "truck_equipment_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "tow_trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "tow_trucks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_zone_categories" ADD CONSTRAINT "service_zone_categories_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_zone_categories" ADD CONSTRAINT "service_zone_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_fleetContractId_fkey" FOREIGN KEY ("fleetContractId") REFERENCES "fleet_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_membershipSubscriptionId_fkey" FOREIGN KEY ("membershipSubscriptionId") REFERENCES "membership_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_locations" ADD CONSTRAINT "booking_locations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_vehicle_assessments" ADD CONSTRAINT "booking_vehicle_assessments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_attachments" ADD CONSTRAINT "booking_attachments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_quotes" ADD CONSTRAINT "booking_quotes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_quote_items" ADD CONSTRAINT "booking_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "booking_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "tow_trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_team_members" ADD CONSTRAINT "booking_team_members_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_team_members" ADD CONSTRAINT "booking_team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_condition_reports" ADD CONSTRAINT "vehicle_condition_reports_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custody_confirmations" ADD CONSTRAINT "custody_confirmations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_share_links" ADD CONSTRAINT "booking_share_links_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "membership_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "tow_trucks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "driver_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usages" ADD CONSTRAINT "membership_usages_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "membership_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usages" ADD CONSTRAINT "membership_usages_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_account_members" ADD CONSTRAINT "fleet_account_members_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_account_members" ADD CONSTRAINT "fleet_account_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_contracts" ADD CONSTRAINT "fleet_contracts_fleetAccountId_fkey" FOREIGN KEY ("fleetAccountId") REFERENCES "fleet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_raterUserId_fkey" FOREIGN KEY ("raterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rateeUserId_fkey" FOREIGN KEY ("rateeUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkerZones" ADD CONSTRAINT "_WorkerZones_A_fkey" FOREIGN KEY ("A") REFERENCES "service_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorkerZones" ADD CONSTRAINT "_WorkerZones_B_fkey" FOREIGN KEY ("B") REFERENCES "worker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
