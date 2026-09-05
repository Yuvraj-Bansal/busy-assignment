/**
 * prisma/seed.ts
 *
 * Realistic seed data for the Event Registration system.
 * Run with:  npx prisma db seed   (wire up "prisma.seed" in package.json, see docs)
 *
 * Data included on purpose, to exercise every rule described in the brief:
 *  - 2 Organizers, 3 Check-in Staff
 *  - 1 past event (sessions already ended, has Checked-In / Expired history)
 *  - 1 upcoming event (sessions in the future, live capacity scenarios)
 *  - A session at EXACT capacity -> triggers a CapacityAlert
 *  - A capacity alert that was DISMISSED and then RE-TRIGGERED after the
 *    session filled back up (docs requirement #4)
 *  - Registrations covering all five statuses: RESERVED, CONFIRMED,
 *    CHECKED_IN, CANCELLED, EXPIRED
 *  - A full RegistrationTimeline audit trail for every registration
 *  - Staff assigned to a SUBSET of sessions only, to exercise RBAC scoping
 */

import { PrismaClient, Role, RegistrationStatus, AlertStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Fixed "now" so seed data is reproducible relative to the app's current date.
const NOW = new Date("2026-08-30T10:00:00.000Z");

function minutesAgo(mins: number): Date {
  return new Date(NOW.getTime() - mins * 60_000);
}
function minutesFromNow(mins: number): Date {
  return new Date(NOW.getTime() + mins * 60_000);
}
function daysFromNow(days: number, hour = 0, minute = 0): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}
function daysAgo(days: number, hour = 0, minute = 0): Date {
  return daysFromNow(-days, hour, minute);
}

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("Seeding database...");

  // --------------------------------------------------------------------
  // USERS
  // --------------------------------------------------------------------
  const passwordHash = await hash("Password123!");

  const organizer1 = await prisma.user.create({
    data: {
      name: "Aditi Sharma",
      email: "aditi.organizer@eventreg.dev",
      passwordHash,
      role: Role.ORGANIZER,
    },
  });

  const organizer2 = await prisma.user.create({
    data: {
      name: "Rohan Mehta",
      email: "rohan.organizer@eventreg.dev",
      passwordHash,
      role: Role.ORGANIZER,
    },
  });

  const staff1 = await prisma.user.create({
    data: {
      name: "Neha Kapoor",
      email: "neha.staff@eventreg.dev",
      passwordHash,
      role: Role.CHECK_IN_STAFF,
    },
  });

  const staff2 = await prisma.user.create({
    data: {
      name: "Vikram Singh",
      email: "vikram.staff@eventreg.dev",
      passwordHash,
      role: Role.CHECK_IN_STAFF,
    },
  });

  const staff3 = await prisma.user.create({
    data: {
      name: "Priya Nair",
      email: "priya.staff@eventreg.dev",
      passwordHash,
      role: Role.CHECK_IN_STAFF,
    },
  });

  // --------------------------------------------------------------------
  // EVENTS
  // --------------------------------------------------------------------
  const techConnect = await prisma.event.create({
    data: {
      name: "TechConnect Summit 2026",
      slug: "techconnect-summit-2026",
      description: "A two-day summit on AI, cloud, and startup growth.",
      venueName: "Grand Hyatt, Kanpur",
      startDate: daysFromNow(16, 9, 0),
      endDate: daysFromNow(17, 18, 0),
      organizerId: organizer1.id,
    },
  });

  const devCraft = await prisma.event.create({
    data: {
      name: "DevCraft Workshop Series",
      slug: "devcraft-workshop-series",
      description: "Hands-on backend & database engineering workshops.",
      venueName: "HBTU Innovation Hub",
      startDate: daysAgo(51, 10, 0),
      endDate: daysAgo(51, 18, 0),
      organizerId: organizer2.id,
    },
  });

  // --------------------------------------------------------------------
  // SESSIONS
  // --------------------------------------------------------------------

  // Upcoming session, plenty of room (3/5 filled after seed below)
  const sessKeynote = await prisma.session.create({
    data: {
      eventId: techConnect.id,
      title: "Opening Keynote: The Future of AI",
      description: "Industry leaders on where AI product engineering is headed.",
      location: "Main Hall",
      startTime: daysFromNow(16, 9, 0),
      endTime: daysFromNow(16, 10, 0),
      capacity: 5,
    },
  });

  // Upcoming session, deliberately tiny capacity so it sits AT capacity
  // after seeding -> used to demonstrate CapacityAlert + re-trigger.
  const sessWorkshop = await prisma.session.create({
    data: {
      eventId: techConnect.id,
      title: "Hands-on Workshop: Building with LLMs",
      description: "Small-group hands-on lab, limited seats.",
      location: "Lab Room B",
      startTime: daysFromNow(16, 11, 0),
      endTime: daysFromNow(16, 13, 0),
      capacity: 3,
    },
  });

  // Upcoming session, large capacity, lightly booked
  const sessPanel = await prisma.session.create({
    data: {
      eventId: techConnect.id,
      title: "Panel: Startup Funding in India",
      description: "VCs and founders discuss the current funding climate.",
      location: "Main Hall",
      startTime: daysFromNow(17, 14, 0),
      endTime: daysFromNow(17, 15, 30),
      capacity: 50,
    },
  });

  // Past session (already happened) — has Checked-In / Cancelled / Expired history
  const sessDocker = await prisma.session.create({
    data: {
      eventId: devCraft.id,
      title: "Intro to Docker",
      description: "Containerizing a Node.js + Postgres app from scratch.",
      location: "Innovation Hub, Room 1",
      startTime: daysAgo(51, 10, 0),
      endTime: daysAgo(51, 12, 0),
      capacity: 20,
    },
  });

  // Past session (already happened)
  const sessPostgres = await prisma.session.create({
    data: {
      eventId: devCraft.id,
      title: "Advanced PostgreSQL Tuning",
      description: "Indexes, EXPLAIN ANALYZE, and locking strategies.",
      location: "Innovation Hub, Room 2",
      startTime: daysAgo(51, 13, 0),
      endTime: daysAgo(51, 15, 0),
      capacity: 15,
    },
  });

  // --------------------------------------------------------------------
  // SESSION ASSIGNMENTS  (RBAC scoping — staff can only act on these)
  // --------------------------------------------------------------------
  await prisma.sessionAssignment.createMany({
    data: [
      { sessionId: sessKeynote.id, userId: staff1.id, assignedById: organizer1.id },
      { sessionId: sessWorkshop.id, userId: staff1.id, assignedById: organizer1.id },
      { sessionId: sessPanel.id, userId: staff2.id, assignedById: organizer1.id },
      { sessionId: sessDocker.id, userId: staff3.id, assignedById: organizer2.id },
      { sessionId: sessPostgres.id, userId: staff3.id, assignedById: organizer2.id },
    ],
  });

  // --------------------------------------------------------------------
  // Helper: create a Registration + its full timeline in one go
  // --------------------------------------------------------------------
  type TimelineStep = {
    oldStatus: RegistrationStatus | null;
    newStatus: RegistrationStatus;
    actorId: string | null;
    note: string;
    timestamp: Date;
  };

  async function createRegistrationWithTimeline(params: {
    sessionId: string;
    attendeeName: string;
    attendeeEmail: string;
    attendeePhone?: string;
    status: RegistrationStatus;
    createdById: string | null;
    reservedAt: Date;
    expiresAt?: Date | null;
    confirmedAt?: Date | null;
    checkedInAt?: Date | null;
    cancelledAt?: Date | null;
    cancelReason?: string | null;
    steps: TimelineStep[];
  }) {
    const reg = await prisma.registration.create({
      data: {
        sessionId: params.sessionId,
        attendeeName: params.attendeeName,
        attendeeEmail: params.attendeeEmail,
        attendeePhone: params.attendeePhone,
        status: params.status,
        createdById: params.createdById,
        reservedAt: params.reservedAt,
        expiresAt: params.expiresAt ?? null,
        confirmedAt: params.confirmedAt ?? null,
        checkedInAt: params.checkedInAt ?? null,
        cancelledAt: params.cancelledAt ?? null,
        cancelReason: params.cancelReason ?? null,
      },
    });

    for (const step of params.steps) {
      await prisma.registrationTimeline.create({
        data: {
          registrationId: reg.id,
          actorId: step.actorId,
          oldStatus: step.oldStatus,
          newStatus: step.newStatus,
          note: step.note,
          timestamp: step.timestamp,
        },
      });
    }

    return reg;
  }

  // --------------------------------------------------------------------
  // REGISTRATIONS — Keynote (3/5 filled, no alert)
  // --------------------------------------------------------------------
  await createRegistrationWithTimeline({
    sessionId: sessKeynote.id,
    attendeeName: "Ishaan Verma",
    attendeeEmail: "ishaan.verma@example.com",
    status: RegistrationStatus.CONFIRMED,
    createdById: null, // self-service public registration
    reservedAt: minutesAgo(60 * 24 * 3),
    confirmedAt: minutesAgo(60 * 24 * 3 - 5),
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: minutesAgo(60 * 24 * 3) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: minutesAgo(60 * 24 * 3 - 5) },
    ],
  });

  await createRegistrationWithTimeline({
    sessionId: sessKeynote.id,
    attendeeName: "Sanya Kapoor",
    attendeeEmail: "sanya.kapoor@example.com",
    status: RegistrationStatus.CONFIRMED,
    createdById: staff1.id,
    reservedAt: minutesAgo(60 * 24 * 2),
    confirmedAt: minutesAgo(60 * 24 * 2 - 10),
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: staff1.id, note: "Reserved on attendee's behalf at info desk", timestamp: minutesAgo(60 * 24 * 2) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: staff1.id, note: "Confirmed after payment verified", timestamp: minutesAgo(60 * 24 * 2 - 10) },
    ],
  });

  await createRegistrationWithTimeline({
    sessionId: sessKeynote.id,
    attendeeName: "Aryan Bhatt",
    attendeeEmail: "aryan.bhatt@example.com",
    status: RegistrationStatus.RESERVED,
    createdById: null,
    reservedAt: minutesAgo(10),
    expiresAt: minutesFromNow(5), // still within the expiry window — a live "about to expire" case
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created, awaiting confirmation", timestamp: minutesAgo(10) },
    ],
  });

  // --------------------------------------------------------------------
  // REGISTRATIONS — Workshop (capacity 3; ends up EXACTLY full -> alert)
  // --------------------------------------------------------------------

  // Seat A: originally reserved, later cancelled, freeing a seat temporarily
  const workshopRegA = await createRegistrationWithTimeline({
    sessionId: sessWorkshop.id,
    attendeeName: "Karan Malhotra",
    attendeeEmail: "karan.malhotra@example.com",
    status: RegistrationStatus.CANCELLED,
    createdById: null,
    reservedAt: minutesAgo(60 * 5),
    confirmedAt: minutesAgo(60 * 5 - 10),
    cancelledAt: minutesAgo(60 * 2),
    cancelReason: "Schedule conflict",
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: minutesAgo(60 * 5) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: minutesAgo(60 * 5 - 10) },
      { oldStatus: RegistrationStatus.CONFIRMED, newStatus: RegistrationStatus.CANCELLED, actorId: staff1.id, note: "Cancelled by staff at attendee's request — schedule conflict", timestamp: minutesAgo(60 * 2) },
    ],
  });

  // Seats B & C: confirmed, still active
  await createRegistrationWithTimeline({
    sessionId: sessWorkshop.id,
    attendeeName: "Divya Rao",
    attendeeEmail: "divya.rao@example.com",
    status: RegistrationStatus.CONFIRMED,
    createdById: null,
    reservedAt: minutesAgo(60 * 6),
    confirmedAt: minutesAgo(60 * 6 - 10),
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: minutesAgo(60 * 6) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: minutesAgo(60 * 6 - 10) },
    ],
  });

  await createRegistrationWithTimeline({
    sessionId: sessWorkshop.id,
    attendeeName: "Yash Trivedi",
    attendeeEmail: "yash.trivedi@example.com",
    status: RegistrationStatus.CONFIRMED,
    createdById: null,
    reservedAt: minutesAgo(60 * 4),
    confirmedAt: minutesAgo(60 * 4 - 8),
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: minutesAgo(60 * 4) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: minutesAgo(60 * 4 - 8) },
    ],
  });

  // Seat A refilled AFTER the cancellation above -> this is what re-triggers the alert
  await createRegistrationWithTimeline({
    sessionId: sessWorkshop.id,
    attendeeName: "Meera Iyer",
    attendeeEmail: "meera.iyer@example.com",
    status: RegistrationStatus.CONFIRMED,
    createdById: staff1.id,
    reservedAt: minutesAgo(30),
    confirmedAt: minutesAgo(25),
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: staff1.id, note: "Reserved from waitlist after a seat opened up", timestamp: minutesAgo(30) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: staff1.id, note: "Confirmed on-site", timestamp: minutesAgo(25) },
    ],
  });

  void workshopRegA; // kept for readability of the narrative above

  // --------------------------------------------------------------------
  // REGISTRATIONS — Panel (lightly booked, 5/50)
  // --------------------------------------------------------------------
  const panelAttendees = [
    ["Rhea Choudhary", "rhea.choudhary@example.com"],
    ["Aman Gupta", "aman.gupta@example.com"],
    ["Simran Kaur", "simran.kaur@example.com"],
    ["Devansh Joshi", "devansh.joshi@example.com"],
    ["Ananya Pillai", "ananya.pillai@example.com"],
  ] as const;

  for (const [name, email] of panelAttendees) {
    const reservedAt = minutesAgo(60 * 24);
    await createRegistrationWithTimeline({
      sessionId: sessPanel.id,
      attendeeName: name,
      attendeeEmail: email,
      status: RegistrationStatus.CONFIRMED,
      createdById: null,
      reservedAt,
      confirmedAt: new Date(reservedAt.getTime() + 5 * 60_000),
      steps: [
        { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: reservedAt },
        { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: new Date(reservedAt.getTime() + 5 * 60_000) },
      ],
    });
  }

  // --------------------------------------------------------------------
  // REGISTRATIONS — Intro to Docker (past session): Checked-In / Cancelled / Expired history
  // --------------------------------------------------------------------
  const dockerCheckedIn = [
    "Tanvi Desai", "Arjun Nambiar", "Kabir Sethi", "Riya Chatterjee",
    "Omkar Patil", "Lakshmi Menon", "Rudra Bose", "Anika Reddy",
  ];
  let t = daysAgo(52, 9, 0);
  for (const name of dockerCheckedIn) {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    const reservedAt = new Date(t.getTime());
    const confirmedAt = new Date(reservedAt.getTime() + 10 * 60_000);
    const checkedInAt = daysAgo(51, 10, 5);
    await createRegistrationWithTimeline({
      sessionId: sessDocker.id,
      attendeeName: name,
      attendeeEmail: email,
      status: RegistrationStatus.CHECKED_IN,
      createdById: null,
      reservedAt,
      confirmedAt,
      checkedInAt,
      steps: [
        { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: reservedAt },
        { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: confirmedAt },
        { oldStatus: RegistrationStatus.CONFIRMED, newStatus: RegistrationStatus.CHECKED_IN, actorId: staff3.id, note: "Checked in at venue entrance", timestamp: checkedInAt },
      ],
    });
    t = new Date(t.getTime() + 30 * 60_000);
  }

  await createRegistrationWithTimeline({
    sessionId: sessDocker.id,
    attendeeName: "Farhan Ali",
    attendeeEmail: "farhan.ali@example.com",
    status: RegistrationStatus.CANCELLED,
    createdById: null,
    reservedAt: daysAgo(53, 9, 0),
    confirmedAt: daysAgo(53, 9, 10),
    cancelledAt: daysAgo(52, 18, 0),
    cancelReason: "Attendee could not make it",
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: daysAgo(53, 9, 0) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: daysAgo(53, 9, 10) },
      { oldStatus: RegistrationStatus.CONFIRMED, newStatus: RegistrationStatus.CANCELLED, actorId: null, note: "Self-service cancellation", timestamp: daysAgo(52, 18, 0) },
    ],
  });

  await createRegistrationWithTimeline({
    sessionId: sessDocker.id,
    attendeeName: "Nikhil Chawla",
    attendeeEmail: "nikhil.chawla@example.com",
    status: RegistrationStatus.CANCELLED,
    createdById: staff3.id,
    reservedAt: daysAgo(53, 11, 0),
    cancelledAt: daysAgo(52, 20, 0),
    cancelReason: "Duplicate registration",
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: staff3.id, note: "Reserved at info desk", timestamp: daysAgo(53, 11, 0) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CANCELLED, actorId: staff3.id, note: "Cancelled — duplicate of an existing confirmed registration", timestamp: daysAgo(52, 20, 0) },
    ],
  });

  // Reserved but never confirmed before the event — system auto-expired it
  await createRegistrationWithTimeline({
    sessionId: sessDocker.id,
    attendeeName: "Gaurav Bansal",
    attendeeEmail: "gaurav.bansal@example.com",
    status: RegistrationStatus.EXPIRED,
    createdById: null,
    reservedAt: daysAgo(52, 8, 0),
    expiresAt: daysAgo(52, 8, 15),
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: daysAgo(52, 8, 0) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.EXPIRED, actorId: null, note: "Auto-expired by system: not confirmed within 15-minute reservation window", timestamp: daysAgo(52, 8, 15) },
    ],
  });

  // --------------------------------------------------------------------
  // REGISTRATIONS — Advanced PostgreSQL Tuning (past session)
  // --------------------------------------------------------------------
  const pgCheckedIn = ["Sameer Khanna", "Pooja Iyengar", "Rajat Suri", "Neelam Bhardwaj", "Aditya Ranganathan"];
  let t2 = daysAgo(51, 12, 30);
  for (const name of pgCheckedIn) {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
    const reservedAt = new Date(t2.getTime());
    const confirmedAt = new Date(reservedAt.getTime() + 10 * 60_000);
    const checkedInAt = daysAgo(51, 13, 5);
    await createRegistrationWithTimeline({
      sessionId: sessPostgres.id,
      attendeeName: name,
      attendeeEmail: email,
      status: RegistrationStatus.CHECKED_IN,
      createdById: null,
      reservedAt,
      confirmedAt,
      checkedInAt,
      steps: [
        { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: reservedAt },
        { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: confirmedAt },
        { oldStatus: RegistrationStatus.CONFIRMED, newStatus: RegistrationStatus.CHECKED_IN, actorId: staff3.id, note: "Checked in at venue entrance", timestamp: checkedInAt },
      ],
    });
    t2 = new Date(t2.getTime() + 20 * 60_000);
  }

  await createRegistrationWithTimeline({
    sessionId: sessPostgres.id,
    attendeeName: "Harshita Bajaj",
    attendeeEmail: "harshita.bajaj@example.com",
    status: RegistrationStatus.CANCELLED,
    createdById: null,
    reservedAt: daysAgo(52, 9, 0),
    confirmedAt: daysAgo(52, 9, 10),
    cancelledAt: daysAgo(51, 12, 0),
    cancelReason: "Conflict with another session",
    steps: [
      { oldStatus: null, newStatus: RegistrationStatus.RESERVED, actorId: null, note: "Self-service registration created", timestamp: daysAgo(52, 9, 0) },
      { oldStatus: RegistrationStatus.RESERVED, newStatus: RegistrationStatus.CONFIRMED, actorId: null, note: "Attendee confirmed via email link", timestamp: daysAgo(52, 9, 10) },
      { oldStatus: RegistrationStatus.CONFIRMED, newStatus: RegistrationStatus.CANCELLED, actorId: null, note: "Self-service cancellation", timestamp: daysAgo(51, 12, 0) },
    ],
  });

  // --------------------------------------------------------------------
  // CAPACITY ALERTS for the Workshop session
  // --------------------------------------------------------------------
  // Alert #1: triggered when the workshop first hit 3/3 (before Karan's
  // cancellation freed a seat), then dismissed by the organizer.
  await prisma.capacityAlert.create({
    data: {
      sessionId: sessWorkshop.id,
      status: AlertStatus.DISMISSED,
      currentCount: 3,
      capacity: 3,
      triggeredAt: minutesAgo(60 * 5 - 15),
      dismissedAt: minutesAgo(60 * 3),
      dismissedById: organizer1.id,
    },
  });

  // Alert #2: RE-TRIGGERED after Meera's registration refilled the seat that
  // Karan's cancellation had freed. Still ACTIVE — nobody has dismissed it yet.
  await prisma.capacityAlert.create({
    data: {
      sessionId: sessWorkshop.id,
      status: AlertStatus.ACTIVE,
      currentCount: 3,
      capacity: 3,
      triggeredAt: minutesAgo(25),
      dismissedAt: null,
      dismissedById: null,
    },
  });

  console.log("Seed complete.");
  console.log({
    users: { organizer1: organizer1.email, organizer2: organizer2.email, staff1: staff1.email, staff2: staff2.email, staff3: staff3.email },
    events: { techConnect: techConnect.slug, devCraft: devCraft.slug },
    sessions: {
      sessKeynote: sessKeynote.title,
      sessWorkshop: `${sessWorkshop.title} (AT CAPACITY — alert demo)`,
      sessPanel: sessPanel.title,
      sessDocker: sessDocker.title,
      sessPostgres: sessPostgres.title,
    },
    note: "All seed users share the password: Password123!",
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
