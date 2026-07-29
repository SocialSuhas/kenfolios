/**
 * =============================================================================
 * KENFOLIOS WHATSAPP REMINDER WORKER
 * =============================================================================
 *
 * SOURCE DATABASE
 * Binding : MEMBERS_DB
 * Table   : members
 *
 * LOG DATABASE
 * Binding : WHATSAPP_DB
 *
 * Tables
 *   • worker_state
 *   • worker_runs
 *   • whatsapp_messages
 *
 * CLOUDFLARE SECRETS
 *   • TWILIO_ACCOUNT_SID
 *   • TWILIO_AUTH_TOKEN
 *
 * CLOUDFLARE VARIABLES
 *   • WORKER_NAME
 *   • WORKER_ENABLED
 *   • TEST_MODE
 *   • TEST_MEMBER_IDS
 *   • TEST_MESSAGE_LIMIT
 *   • SEND_START_HOUR
 *   • SEND_END_HOUR
 *   • MESSAGES_PER_CRON
 *   • START_MEMBER_ID
 *   • END_MEMBER_ID
 *   • CAMPAIGN_NAME
 *   • TEMPLATE_NAME
 *   • CONTENT_SID
 *   • DEFAULT_COUNTRY_CODE
 *   • TWILIO_WHATSAPP_NUMBER
 *
 * Trigger
 *   • External Cron (Every Minute)
 *
 * =============================================================================
 */

const IST_TIMEZONE = "Asia/Kolkata";


/* =============================================================================
   LOAD CONFIGURATION
============================================================================= */

function parseBoolean(value, defaultValue = false) {

    if (value === undefined || value === null || value === "")
        return defaultValue;

    return String(value).toLowerCase() === "true";

}

function parseInteger(value, defaultValue = 0) {

    const parsed = parseInt(value, 10);

    return Number.isNaN(parsed)
        ? defaultValue
        : parsed;

}

function parseArray(value) {

    if (!value)
        return [];

    return String(value)

        .split(",")

        .map(v => parseInt(v.trim(), 10))

        .filter(v => !Number.isNaN(v));

}

function getConfig(env) {

    return {

        WORKER_NAME:
            env.WORKER_NAME || "whatsapp_sender",

        WORKER_ENABLED:
            parseBoolean(
                env.WORKER_ENABLED,
                true
            ),

        TEST_MODE:
            parseBoolean(
                env.TEST_MODE,
                true
            ),

        TEST_MEMBER_IDS:
            parseArray(
                env.TEST_MEMBER_IDS
            ),

        TEST_MESSAGE_LIMIT:
            parseInteger(
                env.TEST_MESSAGE_LIMIT,
                1
            ),

        SEND_START_HOUR:
            parseInteger(
                env.SEND_START_HOUR,
                12
            ),

        SEND_END_HOUR:
            parseInteger(
                env.SEND_END_HOUR,
                20
            ),

        MESSAGES_PER_CRON:
            parseInteger(
                env.MESSAGES_PER_CRON,
                1
            ),

        START_MEMBER_ID:
            parseInteger(
                env.START_MEMBER_ID,
                1
            ),

        END_MEMBER_ID:
            parseInteger(
                env.END_MEMBER_ID,
                999999999
            ),

        CAMPAIGN_NAME:
            env.CAMPAIGN_NAME ||
            "July 2026 Payment Reminder",

        TEMPLATE_NAME:
            env.TEMPLATE_NAME ||
            "account_activation_reminder",

        CONTENT_SID:
            env.CONTENT_SID,

        DEFAULT_COUNTRY_CODE:
            env.DEFAULT_COUNTRY_CODE ||
            "91"

    };

}


/* =============================================================================
   LOGGER
============================================================================= */

function log(...args) {

    console.log("[KENFOLIOS]", ...args);

}


/* =============================================================================
   CURRENT IST DATE
============================================================================= */

function getISTNow() {

    return new Date(

        new Date().toLocaleString(

            "en-US",

            {

                timeZone: IST_TIMEZONE

            }

        )

    );

}
/* =============================================================================
   CHECK PRODUCTION SENDING WINDOW
============================================================================= */

function canSendNow(config) {

    if (config.TEST_MODE)
        return true;

    const hour = getISTNow().getHours();

    return (

        hour >= config.SEND_START_HOUR

        &&

        hour < config.SEND_END_HOUR

    );

}


/* =============================================================================
   PHONE NORMALIZATION
============================================================================= */

function normalizePhone(phone, config) {

    if (!phone)
        return null;

    let number = String(phone)

        .replace(/\D/g, "");

    if (

        number.startsWith("91")

        &&

        number.length === 12

    ) {

        number = number.substring(2);

    }

    else if (

        number.startsWith("0")

        &&

        number.length === 11

    ) {

        number = number.substring(1);

    }

    if (!/^\d{10}$/.test(number))
        return null;

    return `whatsapp:+${config.DEFAULT_COUNTRY_CODE}${number}`;

}


/* =============================================================================
   FORMAT MEMBER CREATED DATE
============================================================================= */

function formatCreatedAt(createdAt) {

    if (!createdAt)
        return "";

    const utc = new Date(createdAt);

    if (isNaN(utc.getTime()))
        return "";

    const ist = new Date(

        utc.toLocaleString(

            "en-US",

            {

                timeZone: IST_TIMEZONE

            }

        )

    );

    const day = ist.getDate();

    const suffix =

        day === 1 || day === 21 || day === 31 ? "st" :

        day === 2 || day === 22 ? "nd" :

        day === 3 || day === 23 ? "rd" :

        "th";

    const month = ist.toLocaleString(

        "en-IN",

        {

            month: "long"

        }

    );

    const year = ist.getFullYear();

    const time = ist.toLocaleString(

        "en-IN",

        {

            hour: "numeric",

            minute: "2-digit",

            hour12: true

        }

    );

    return `${day}${suffix} ${month} ${year} at ${time} IST`;

}


/* =============================================================================
   BUILD TEMPLATE VARIABLES
============================================================================= */

function buildVariables(member) {

    return {

        "1": member.full_name,

        "2": formatCreatedAt(
            member.created_at
        ),

        "3": member.ref_id

    };

}


/* =============================================================================
   FETCH
============================================================================= */

async function handleFetch(request, env) {

    const config = getConfig(env);

    return Response.json({

        worker: config.WORKER_NAME,

        status: "OK",

        mode: config.TEST_MODE

            ? "TEST"

            : "PRODUCTION"

    });

}
/* =============================================================================
   GET WORKER STATE
============================================================================= */

async function getWorkerState(env, config) {

    const state = await env.WHATSAPP_DB

        .prepare(`

            SELECT *

            FROM worker_state

            WHERE worker_name = ?

            LIMIT 1

        `)

        .bind(config.WORKER_NAME)

        .first();

    if (!state) {

        throw new Error(

            `worker_state not found for '${config.WORKER_NAME}'`

        );

    }

    return state;

}


/* =============================================================================
   CREATE WORKER RUN
============================================================================= */

async function createWorkerRun(env) {

    const result = await env.WHATSAPP_DB

        .prepare(`

            INSERT INTO worker_runs (

                started_at

            )

            VALUES (

                CURRENT_TIMESTAMP

            )

        `)

        .run();

    return result.meta.last_row_id;

}


/* =============================================================================
   COMPLETE WORKER RUN
============================================================================= */

async function finishWorkerRun(

    env,

    runId,

    membersFound,

    processed,

    sent,

    failed,

    notes

) {

    await env.WHATSAPP_DB

        .prepare(`

            UPDATE worker_runs

            SET

                finished_at = CURRENT_TIMESTAMP,

                members_found = ?,

                processed = ?,

                sent = ?,

                failed = ?,

                notes = ?

            WHERE id = ?

        `)

        .bind(

            membersFound,

            processed,

            sent,

            failed,

            notes,

            runId

        )

        .run();

}


/* =============================================================================
   UPDATE WORKER STATE
============================================================================= */

async function updateWorkerState(

    env,

    config,

    lastMemberId,

    processed,

    sent,

    failed

) {

    await env.WHATSAPP_DB

        .prepare(`

            UPDATE worker_state

            SET

                last_member_id = ?,

                last_message_sent_at = CURRENT_TIMESTAMP,

                total_processed = total_processed + ?,

                total_sent = total_sent + ?,

                total_failed = total_failed + ?,

                updated_at = CURRENT_TIMESTAMP

            WHERE worker_name = ?

        `)

        .bind(

            lastMemberId,

            processed,

            sent,

            failed,

            config.WORKER_NAME

        )

        .run();

}


/* =============================================================================
   LOG WHATSAPP MESSAGE
============================================================================= */

async function logMessage(

    env,

    config,

    member,

    status,

    messageSid,

    errorCode,

    errorMessage,

    twilioResponse,

    isTest

) {

    await env.WHATSAPP_DB

        .prepare(`

            INSERT INTO whatsapp_messages (

                member_id,

                campaign_name,

                template_name,

                full_name,

                phone,

                email,

                twilio_message_sid,

                status,

                error_code,

                error_message,

                sent_at,

                twilio_response

            )

            VALUES (

                ?,?,?,?,?,?,?,?,?,?,

                CURRENT_TIMESTAMP,

                ?

            )

        `)

        .bind(

            member.id,

            config.CAMPAIGN_NAME,

            config.TEMPLATE_NAME,

            member.full_name,

            member.phone,

            member.email,

            messageSid,

            isTest

                ? "TEST_" + status

                : status,

            errorCode,

            errorMessage,

            twilioResponse

        )

        .run();

}


/* =============================================================================
   GET TEST MEMBERS
============================================================================= */

async function getTestMembers(env, config) {

    const placeholders =

        config.TEST_MEMBER_IDS

            .map(() => "?")

            .join(",");

    const result = await env.MEMBERS_DB

        .prepare(`

            SELECT *

            FROM members

            WHERE id IN (${placeholders})

            ORDER BY id

            LIMIT ?

        `)

        .bind(

            ...config.TEST_MEMBER_IDS,

            config.TEST_MESSAGE_LIMIT

        )

        .all();

    return result.results;

}


/* =============================================================================
   GET PRODUCTION MEMBERS
============================================================================= */

async function getMembers(

    env,

    config,

    lastMemberId

) {

    const result = await env.MEMBERS_DB

        .prepare(`

            SELECT *

            FROM members

            WHERE

                id > ?

            AND

                id >= ?

            AND

                id <= ?

            ORDER BY id

            LIMIT ?

        `)

        .bind(

            lastMemberId,

            config.START_MEMBER_ID,

            config.END_MEMBER_ID,

            config.MESSAGES_PER_CRON

        )

        .all();

    return result.results;

}


/* =============================================================================
   SEND WHATSAPP
============================================================================= */

async function sendWhatsapp(env, config, member) {

    const phone = normalizePhone(member.phone, config);

    if (!phone) {

        return {

            success: false,

            errorCode: "INVALID_PHONE",

            errorMessage: "Invalid phone number"

        };

    }

    const body = new URLSearchParams();

    body.append("From", env.TWILIO_WHATSAPP_NUMBER);

    body.append("To", phone);

    body.append("ContentSid", config.CONTENT_SID);

    body.append(

        "ContentVariables",

        JSON.stringify(

            buildVariables(member)

        )

    );

    try {

        const response = await fetch(

            `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,

            {

                method: "POST",

                headers: {

                    Authorization:

                        "Basic " +

                        btoa(

                            `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`

                        ),

                    "Content-Type":

                        "application/x-www-form-urlencoded"

                },

                body

            }

        );

        const text = await response.text();

        let json = {};

        try {

            json = JSON.parse(text);

        }

        catch {

            json = {};

        }

        if (!response.ok) {

            return {

                success: false,

                errorCode: json.code || response.status,

                errorMessage: json.message || response.statusText,

                response: text

            };

        }

        return {

            success: true,

            sid: json.sid || null,

            response: text

        };

    }

    catch (e) {

        return {

            success: false,

            errorCode: "NETWORK_ERROR",

            errorMessage: e.message,

            response: ""

        };

    }

}
/* =============================================================================
   PROCESS MEMBERS
============================================================================= */

async function processMembers(env, config) {

    const runId = await createWorkerRun(env);

    let members = [];

    let lastMemberId = 0;

    if (config.TEST_MODE) {

        members = await getTestMembers(env, config);

    }

    else {

        const state = await getWorkerState(

            env,

            config

        );

        lastMemberId = state.last_member_id || 0;

        members = await getMembers(

            env,

            config,

            lastMemberId

        );

    }

    let processed = 0;

    let sent = 0;

    let failed = 0;

    let highestMemberId = lastMemberId;

    for (const member of members) {

        processed++;

        highestMemberId = member.id;

        log(

            "Sending",

            member.id,

            member.full_name,

            member.phone

        );

        const result = await sendWhatsapp(

            env,

            config,

            member

        );

        if (result.success) {

            sent++;

        }

        else {

            failed++;

        }

        await logMessage(

            env,

            config,

            member,

            result.success

                ? "success"

                : "failed",

            result.sid || null,

            result.errorCode || null,

            result.errorMessage || null,

            result.response || "",

            config.TEST_MODE

        );

    }

    if (

        !config.TEST_MODE

        &&

        highestMemberId > 0

    ) {

        await updateWorkerState(

            env,

            config,

            highestMemberId,

            processed,

            sent,

            failed

        );

    }

    await finishWorkerRun(

        env,

        runId,

        members.length,

        processed,

        sent,

        failed,

        config.TEST_MODE

            ? "TEST"

            : "PRODUCTION"

    );

}


/* =============================================================================
   SCHEDULED
============================================================================= */

async function scheduled(event, env) {

    const config = getConfig(env);

    if (!config.WORKER_ENABLED) {

        log("Worker Disabled");

        return;

    }

    if (

        !config.TEST_MODE

        &&

        !canSendNow(config)

    ) {

        log("Outside Sending Window");

        return;

    }

    if (!env.TWILIO_WHATSAPP_NUMBER) {

        throw new Error(

            "TWILIO_WHATSAPP_NUMBER not configured."

        );

    }

    if (!config.CONTENT_SID) {

        throw new Error(

            "CONTENT_SID not configured."

        );

    }

    await processMembers(

        env,

        config

    );

}


/* =============================================================================
   EXPORT
============================================================================= */

export default {

    fetch: handleFetch,

    scheduled

};
