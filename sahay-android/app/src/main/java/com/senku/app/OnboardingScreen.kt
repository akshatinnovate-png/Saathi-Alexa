package com.senku.app

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay

private val Paper = Color(0xFFF8F7F3)
private val Ink = Color(0xFF172033)
private val Muted = Color(0xFF687181)
private val Line = Color(0xFFE0E3E7)
private val Shape = RoundedCornerShape(17.dp)
private val Palette = listOf("seaglass" to "Sea glass", "blue" to "Blue", "pink" to "Pink", "red" to "Red")

private fun glowAccent(selected: String): Color = when (selected) {
    "blue" -> Color(0xFF438FD0)
    "pink" -> Color(0xFFD86EA9)
    "red" -> Color(0xFFE26E68)
    else -> Color(0xFF43B9AA)
}

@Composable
internal fun BrandWordmark(fontSize: Int = 23) {
    Text("senku.", color = Ink, fontSize = fontSize.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp)
}

/** Use the exact native renderer so previews and the floating orb share a palette. */
@Composable
internal fun NativeOrb(selected: String, modifier: Modifier = Modifier) {
    AndroidView(factory = { CompanionView(it).apply { setMode("listening") } },
        update = { it.setTheme(selected) }, modifier = modifier)
}

@Composable
private fun Heading(text: String) {
    Text(text, color = Ink, fontSize = 32.sp, lineHeight = 37.sp,
        fontWeight = FontWeight.ExtraBold, letterSpacing = (-1.2).sp, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Body(text: String) {
    Text(text, color = Muted, fontSize = 15.sp, lineHeight = 23.sp,
        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Primary(label: String, enabled: Boolean = true, action: () -> Unit) {
    Button(onClick = action, enabled = enabled, shape = Shape,
        colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Color.White),
        modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
        Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
}

@Composable
internal fun SignInScreen(message: String, busy: Boolean, onSaveKey: (String) -> Unit) {
    val context = LocalContext.current
    var key by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding().imePadding()
        .padding(horizontal = 26.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().fillMaxHeight()) {
            BrandWordmark()
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                Heading("Meet Sahay.")
                Spacer(Modifier.height(20.dp))
                Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                    NativeOrb("seaglass", Modifier.size(176.dp))
                }
                Spacer(Modifier.height(16.dp))
                Text("Sahay is free. It runs on Google Gemini with your own free key: no account, no plan, no charges.",
                    color = Muted, fontSize = 14.sp, lineHeight = 20.sp, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey"))) } },
                shape = Shape, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
                Text("1. Get a free key from Google", color = Ink, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = key, onValueChange = { key = it }, singleLine = true,
                label = { Text("2. Paste your Gemini key here") },
                placeholder = { Text("AIza…  (several keys: separate with commas)") },
                modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            Button(onClick = { onSaveKey(key) }, enabled = !busy && key.isNotBlank(), shape = Shape,
                colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
                Text("3. Start", fontWeight = FontWeight.SemiBold)
            }
            if (message.isNotBlank()) Spacer(Modifier.height(12.dp))
            if (message.isNotBlank()) Text(message, color = Muted, fontSize = 13.sp, lineHeight = 19.sp,
                modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        }
    }
}

@Composable
internal fun ColourScreen(selected: String, onColour: (String) -> Unit, onContinue: () -> Unit) {
    val colourName = Palette.firstOrNull { it.first == selected }?.second ?: "Sea glass"
    Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 20.dp)) {
        BrandWordmark()
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(36.dp))
            Heading("Make Sahay yours.")
            Spacer(Modifier.height(12.dp))
            Body("A little colour. A little you.")
            Spacer(Modifier.height(20.dp))
            Box(Modifier.fillMaxWidth().heightIn(max = 300.dp).aspectRatio(1f), contentAlignment = Alignment.Center) {
                NativeOrb(selected, Modifier.fillMaxSize())
            }
            Spacer(Modifier.height(10.dp))
            Text(colourName, color = Ink, fontSize = 23.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))
            Row(
                Modifier.widthIn(max = 320.dp).fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Palette.forEach { (id, name) ->
                    val chosen = selected == id
                    val colours = when (id) {
                        "blue" -> listOf(Color(0xFF76BAF2), Color(0xFFC3F7FD))
                        "pink" -> listOf(Color(0xFFEE8FBA), Color(0xFFFFEDF6))
                        "red" -> listOf(Color(0xFFF18A80), Color(0xFFFFE6CA))
                        else -> listOf(Color(0xFF61C9B8), Color(0xFFD4FBF2))
                    }
                    Surface(
                        onClick = { onColour(id) },
                        shape = CircleShape,
                        color = Color.Transparent,
                        border = if (chosen) BorderStroke(2.dp, Ink) else null,
                        modifier = Modifier.size(60.dp).semantics { contentDescription = if (chosen) "$name selected" else name }
                    ) {
                        Box(Modifier.padding(5.dp).background(androidx.compose.ui.graphics.Brush.verticalGradient(colours), CircleShape), contentAlignment = Alignment.Center) {
                            if (chosen) Text("✓", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
        }
        Spacer(Modifier.height(12.dp))
        Primary("Looks good", action = onContinue)
        Spacer(Modifier.height(12.dp))
        Text("You can change this in Settings.", color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
internal fun OnboardingScreen(step: Int, selected: String, accessibilityAttempted: Boolean, restrictedSettingsOpened: Boolean,
    onContinue: () -> Unit, onAccessibility: () -> Unit, onRestrictedSettings: () -> Unit) {
    if (step == 4) {
        Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            BrandWordmark()
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(70.dp))
                NativeOrb(selected, Modifier.size(210.dp))
                Heading("Meet your helping hand.")
                Spacer(Modifier.height(24.dp))
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Body("Tap Sahay to wake it up.")
                    Body("Ask a question or say what you’d like done on your phone.")
                    Body("Tap again to put Sahay to sleep.")
                }
                Spacer(Modifier.height(24.dp))
            }
            Primary("Let’s try it", action = onContinue)
        }
    } else if (step == 3) {
        AccessibilitySetupScreen(
            selected = selected,
            accessibilityAttempted = accessibilityAttempted,
            restrictedSettingsOpened = restrictedSettingsOpened,
            onAccessibility = onAccessibility,
            onRestrictedSettings = onRestrictedSettings
        )
    } else {
        StandardOnboardingScreen(step, selected, onContinue)
    }
}

@Composable
private fun StandardOnboardingScreen(step: Int, selected: String, onContinue: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding().padding(24.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            BrandWordmark()
            Spacer(Modifier.weight(1f))
            Text(if (step == 1) "03 / 03" else "02 / 03", color = Muted, fontSize = 12.sp)
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(38.dp))
            Heading(if (step == 1) "Keep me close." else "Let’s talk.")
            NativeOrb(selected, Modifier.size(220.dp))
            Body(if (step == 1) "Let Sahay appear over your apps, so help is always a tap away."
                else "Allow microphone access so you can talk with Sahay when you need help.")
            if (step == 1) {
                Spacer(Modifier.height(16.dp))
                OverlayPermissionGuide(selected)
            }
            Spacer(Modifier.height(24.dp))
        }
        Primary(if (step == 1) "Enable display over apps  →" else "Enable microphone  →", action = onContinue)
        if (step == 1) {
            Spacer(Modifier.height(12.dp))
            Text("Android Settings will open so you can allow display over other apps.",
                color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun OverlayPermissionGuide(selected: String) {
    val context = LocalContext.current
    val reduceMotion = remember {
        runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(reduceMotion) {
        if (!reduceMotion) while (true) {
            delay(if (frame == 0) 2_600L else 1_900L)
            frame = (frame + 1) % 3
        }
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = Color.White,
        border = BorderStroke(1.dp, Line)
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Android settings", color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(12.dp))
            if (reduceMotion) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (0..2).forEach { item ->
                        Box(Modifier.weight(1f).height(116.dp).background(Paper, RoundedCornerShape(13.dp)),
                            contentAlignment = Alignment.Center) {
                            OverlayPermissionScene(item, selected, compact = true)
                        }
                    }
                }
            } else {
                Crossfade(targetState = frame, animationSpec = tween(420), label = "overlay permission guide") { item ->
                    Box(Modifier.fillMaxWidth().height(146.dp), contentAlignment = Alignment.Center) {
                        OverlayPermissionScene(item, selected)
                    }
                }
            }
        }
    }
}

@Composable
private fun OverlayPermissionScene(frame: Int, selected: String, compact: Boolean = false) {
    if (frame == 0) OverlayAppList(selected, compact)
    else OverlayPermissionDetail(selected, enabled = frame == 2, compact = compact)
}

@Composable
private fun OverlayAppList(selected: String, compact: Boolean) {
    val accent = glowAccent(selected)
    Column(
        Modifier.fillMaxWidth(if (compact) .98f else .9f).height(if (compact) 108.dp else 138.dp)
            .background(Color.White, RoundedCornerShape(14.dp))
            .padding(if (compact) 6.dp else 10.dp)
    ) {
        Text("Display over other apps", color = Ink, fontSize = if (compact) 6.sp else 12.sp,
            lineHeight = if (compact) 7.sp else 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        Spacer(Modifier.height(if (compact) 2.dp else 4.dp))
        Spacer(Modifier.height(if (compact) 4.dp else 8.dp))
        listOf("Calendar", "Sahay", "Photos").forEachIndexed { index, name ->
            val isSenku = index == 1
            Row(
                Modifier.fillMaxWidth().weight(1f)
                    .then(if (isSenku) Modifier.background(accent.copy(alpha = .10f), RoundedCornerShape(8.dp)) else Modifier)
                    .padding(horizontal = if (compact) 3.dp else 7.dp)
                    .padding(vertical = if (compact) 0.dp else 3.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (isSenku) NativeOrb(selected, Modifier.size(if (compact) 12.dp else 23.dp))
                else Box(Modifier.size(if (compact) 12.dp else 23.dp)
                    .background(Color(0xFFE9EDF0), RoundedCornerShape(if (compact) 4.dp else 7.dp)))
                Spacer(Modifier.width(if (compact) 3.dp else 8.dp))
                Text(name, color = Ink, fontSize = if (compact) 6.sp else 11.sp,
                    fontWeight = if (isSenku) FontWeight.Bold else FontWeight.Medium)
                Spacer(Modifier.weight(1f))
                Text("›", color = if (isSenku) accent else Muted, fontSize = if (compact) 10.sp else 18.sp,
                    fontWeight = FontWeight.Medium)
            }
            if (index < 2) HorizontalDivider(color = Line.copy(alpha = .8f), thickness = 0.7.dp)
        }
    }
}

@Composable
private fun OverlayPermissionDetail(selected: String, enabled: Boolean, compact: Boolean) {
    val accent = glowAccent(selected)
    Column(
        Modifier.fillMaxWidth(if (compact) .98f else .88f).height(if (compact) 108.dp else 138.dp)
            .background(Color.White, RoundedCornerShape(14.dp))
            .padding(if (compact) 6.dp else 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("‹", color = Muted, fontSize = if (compact) 9.sp else 18.sp)
            Spacer(Modifier.width(if (compact) 3.dp else 7.dp))
            Text("Display over other apps", color = Ink, fontSize = if (compact) 6.sp else 11.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
        Spacer(Modifier.height(if (compact) 3.dp else 5.dp))
        NativeOrb(selected, Modifier.size(if (compact) 18.dp else 34.dp))
        Text("Sahay", color = Ink, fontSize = if (compact) 7.sp else 11.sp, fontWeight = FontWeight.Bold)
        Text("Version 0.1", color = Muted, fontSize = if (compact) 5.sp else 8.sp)
        Spacer(Modifier.height(if (compact) 3.dp else 6.dp))
        Row(
            Modifier.fillMaxWidth().height(if (compact) 23.dp else 35.dp)
                .background(Paper, RoundedCornerShape(8.dp)).padding(horizontal = if (compact) 4.dp else 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Display over other apps", color = Ink, fontSize = if (compact) 5.sp else 9.sp,
                fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.weight(1f))
            Box(
                Modifier.width(if (compact) 17.dp else 29.dp).height(if (compact) 11.dp else 18.dp)
                    .background(if (enabled) accent else Color(0xFFD8DDE2), CircleShape)
                    .padding(if (compact) 1.dp else 2.dp),
                contentAlignment = if (enabled) Alignment.CenterEnd else Alignment.CenterStart
            ) {
                Box(Modifier.size(if (compact) 9.dp else 14.dp).background(Color.White, CircleShape))
            }
        }
    }
}

@Composable
private fun AccessibilitySetupScreen(
    selected: String,
    accessibilityAttempted: Boolean,
    restrictedSettingsOpened: Boolean,
    onAccessibility: () -> Unit,
    onRestrictedSettings: () -> Unit
) {
    val stage = when {
        restrictedSettingsOpened -> 3
        accessibilityAttempted -> 2
        else -> 1
    }
    val accent = glowAccent(selected)
    Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding().padding(24.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            BrandWordmark()
            Spacer(Modifier.weight(1f))
            NativeOrb(selected, Modifier.size(52.dp))
        }
        Spacer(Modifier.height(26.dp))
        Text("Give Sahay permission to use your phone for you", color = Ink, fontSize = 28.sp, lineHeight = 34.sp,
            fontWeight = FontWeight.ExtraBold, letterSpacing = (-.7).sp)
        Spacer(Modifier.height(24.dp))
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            AccessibilityStepRow(1, "Try enabling Accessibility", "Find Sahay and try turning it on. If Android blocks it, dismiss the warning and return here.", stage == 1, accent)
            StepConnector(stage == 1, accent)
            AccessibilityStepRow(2, "Allow restricted settings", "Open App management → Sahay → ⋮ → Allow restricted settings.", stage == 2, accent)
            StepConnector(stage == 2, accent)
            AccessibilityStepRow(3, "Enable Accessibility", "Return to Accessibility, find Sahay, and turn it on.", stage == 3, accent)
        }
        Spacer(Modifier.weight(1f))
        Primary(when (stage) { 1 -> "Open Accessibility settings"; 2 -> "Open App management"; else -> "Back to Accessibility" },
            action = if (stage == 2) onRestrictedSettings else onAccessibility)
        if (stage == 2) {
            TextButton(onClick = onAccessibility, modifier = Modifier.fillMaxWidth()) { Text("Try Accessibility again", color = Muted) }
        } else if (stage == 3) {
            TextButton(onClick = onRestrictedSettings, modifier = Modifier.fillMaxWidth()) { Text("Open App management again", color = Muted) }
        }
        Spacer(Modifier.height(6.dp))
        Text("Sahay is free and open.", color = Muted, fontSize = 13.sp,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun AccessibilityStepRow(number: Int, title: String, detail: String, active: Boolean, accent: Color) {
    Surface(shape = RoundedCornerShape(22.dp), color = if (active) accent.copy(alpha = .12f) else Color.Transparent,
        border = if (active) BorderStroke(1.dp, accent.copy(alpha = .28f)) else null,
        modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 18.dp), verticalAlignment = Alignment.Top) {
            Surface(shape = CircleShape, color = if (active) accent else Color(0xFFC9CDD3), modifier = Modifier.size(42.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Text(number.toString(), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = if (active) Ink else Muted, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(5.dp))
                Text(detail, color = Muted, fontSize = 14.sp, lineHeight = 20.sp)
            }
        }
    }
}

@Composable
private fun StepConnector(active: Boolean, accent: Color) {
    Box(Modifier.padding(start = 36.dp).width(2.dp).height(16.dp)
        .background(if (active) accent.copy(alpha = .4f) else Line))
}

@Composable
internal fun HomeScreen(selected: String,
    signedInEmail: String, onColour: () -> Unit,
    onVoice: () -> Unit, onSignOut: () -> Unit,
    accessibilityReady: Boolean, displayOverAppsAllowed: Boolean, microphoneAllowed: Boolean,
    onAccessibility: () -> Unit, onOverlayPermission: () -> Unit) {
    var settings by remember { mutableStateOf(false) }
    if (settings) {
        SettingsScreen(
            selected = selected,
            signedInEmail = signedInEmail,
            accessibilityReady = accessibilityReady,
            displayOverAppsAllowed = displayOverAppsAllowed,
            microphoneAllowed = microphoneAllowed,
            onColour = { settings = false; onColour() },
            onAccessibility = onAccessibility,
            onOverlayPermission = onOverlayPermission,
            onSignOut = { settings = false; onSignOut() },
            onBack = { settings = false }
        )
    } else {
        Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                BrandWordmark()
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { settings = true }) { Text("Settings", color = Muted) }
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    NativeOrb(selected, Modifier.size(240.dp).semantics { contentDescription = "Sahay. Tap to talk." }
                        .clickable(onClick = onVoice))
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = onVoice) {
                        Text("Tap to summon Sahay", color = Muted, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
            if (!accessibilityReady) TextButton(onClick = onAccessibility, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Finish accessibility setup", color = Ink)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(
    selected: String,
    signedInEmail: String,
    accessibilityReady: Boolean,
    displayOverAppsAllowed: Boolean,
    microphoneAllowed: Boolean,
    onColour: () -> Unit,
    onAccessibility: () -> Unit,
    onOverlayPermission: () -> Unit,
    onSignOut: () -> Unit,
    onBack: () -> Unit
) {
    val accent = glowAccent(selected)
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().background(Paper).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(onClick = onBack, shape = CircleShape, color = Color.White,
                border = BorderStroke(1.dp, Line), modifier = Modifier.size(44.dp).semantics { contentDescription = "Back" }) {
                Box(contentAlignment = Alignment.Center) {
                    Canvas(Modifier.size(20.dp)) {
                        val stroke = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
                        val arrow = Path().apply {
                            moveTo(size.width * .86f, size.height * .5f)
                            lineTo(size.width * .17f, size.height * .5f)
                            moveTo(size.width * .48f, size.height * .18f)
                            lineTo(size.width * .16f, size.height * .5f)
                            lineTo(size.width * .48f, size.height * .82f)
                        }
                        drawPath(arrow, color = Ink, style = stroke)
                    }
                }
            }
            Column(Modifier.padding(start = 14.dp)) {
                Text("Settings", color = Ink, fontSize = 23.sp, fontWeight = FontWeight.Bold, letterSpacing = (-.5).sp)
            }
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            SettingsGroup("GEMINI KEY") {
                Text("FREE", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = .8.sp)
                Spacer(Modifier.height(6.dp))
                Text(signedInEmail, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, lineHeight = 22.sp)
                Text("No plans, no charges, no limits from Sahay. Google's free Gemini tier applies to your key; add more keys to switch automatically when one is busy.",
                    color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey"))) } },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(13.dp)) {
                    Text("Get another free key", fontSize = 12.sp, color = Ink)
                }
            }

            SettingsGroup("APPEARANCE") {
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                        NativeOrb(selected, Modifier.size(44.dp))
                    }
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text("Orb colour", color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, lineHeight = 18.sp)
                        Text(Palette.firstOrNull { it.first == selected }?.second ?: "Sea glass", color = Muted, fontSize = 12.sp, lineHeight = 16.sp)
                    }
                    TextButton(onClick = onColour, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)) {
                        Text("Change", color = Ink)
                    }
                }
            }

            SettingsGroup("PERMISSIONS") {
                PermissionStatus("Display over apps", displayOverAppsAllowed, "Lets Sahay float above other apps")
                HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 8.dp))
                PermissionStatus("Microphone", microphoneAllowed, "Lets you talk with Sahay")
                HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 8.dp))
                PermissionStatus("Accessibility", accessibilityReady, "Lets Sahay interact with your phone when you ask")
                Spacer(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onOverlayPermission, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(13.dp)) {
                        Text("Display settings", fontSize = 12.sp, color = Ink)
                    }
                    OutlinedButton(onClick = onAccessibility, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(13.dp)) {
                        Text("Accessibility settings", fontSize = 12.sp, color = Ink)
                    }
                }
            }

            SettingsGroup("ABOUT") {
                Text("Sahay for Android is part of Saathi. It is based on Sahay by Steve Aldrin and contributors, used with permission under the PolyForm Noncommercial License.",
                    color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
                Spacer(Modifier.height(4.dp))
                TextButton(
                    onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/akshatinnovate-png/Saathi-Alexa/issues"))) } },
                    contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Report a problem", color = Ink, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
                }
            }

            TextButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text("Change Gemini key", color = Color(0xFFB44949), fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

internal data class SessionAllowance(val used: Int, val limit: Int, val resetDate: java.time.LocalDate, val unlimitedDisplay: Boolean = false)

@Composable
private fun SessionUsageCard(usage: SessionAllowance?, loading: Boolean, accent: Color) {
    Column(Modifier.fillMaxWidth().background(Paper, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (loading) {
            PlanSkeleton()
            Box(Modifier.fillMaxWidth().height(6.dp).background(Line, CircleShape))
        } else if (usage == null) {
            Text("Usage unavailable", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            Text("We couldn’t check your remaining sessions.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
        } else if (usage.unlimitedDisplay || usage.limit == -1) {
            Text("∞ sessions", color = Ink, fontSize = 23.sp, fontWeight = FontWeight.Bold)
            Text("Unlimited sessions · ${usage.used} used this month", color = Muted, fontSize = 13.sp)
        } else {
            val remaining = (usage.limit - usage.used).coerceAtLeast(0)
            Text(when (remaining) { 0 -> "No sessions left"; 1 -> "1 session left"; else -> "$remaining sessions left" },
                color = Ink, fontSize = 23.sp, fontWeight = FontWeight.Bold, lineHeight = 29.sp)
            Text("${usage.used} of ${usage.limit} used this month", color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
            LinearProgressIndicator(
                progress = { if (usage.limit > 0) (usage.used.toFloat() / usage.limit).coerceIn(0f, 1f) else 1f },
                color = accent, trackColor = Line, strokeCap = StrokeCap.Round,
                gapSize = 0.dp, drawStopIndicator = {},
                modifier = Modifier.fillMaxWidth().height(6.dp)
            )
            Text("Resets ${usage.resetDate.format(java.time.format.DateTimeFormatter.ofPattern("d MMMM", java.util.Locale.ENGLISH))}",
                color = Muted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun SettingsGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column {
        Text(title, color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp,
            modifier = Modifier.padding(start = 4.dp, bottom = 7.dp))
        Surface(shape = RoundedCornerShape(19.dp), color = Color.White, border = BorderStroke(1.dp, Line)) {
            Column(Modifier.fillMaxWidth().padding(15.dp), content = content)
        }
    }
}

@Composable
private fun PermissionStatus(title: String, granted: Boolean, detail: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Muted, fontSize = 12.sp, lineHeight = 16.sp)
        }
        Text(if (granted) "On" else "Off", color = if (granted) Color(0xFF288C7D) else Color(0xFFB44949),
            fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PlanSkeleton() {
    val transition = rememberInfiniteTransition(label = "plan status skeleton")
    val opacity by transition.animateFloat(
        initialValue = .65f,
        targetValue = .85f,
        animationSpec = infiniteRepeatable(tween(1800), RepeatMode.Reverse),
        label = "plan placeholder pulse"
    )
    Column(verticalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.padding(vertical = 3.dp)) {
        Box(Modifier.width(64.dp).height(12.dp).background(Line.copy(alpha = opacity), RoundedCornerShape(4.dp)))
        Box(Modifier.width(82.dp).height(7.dp).background(Line.copy(alpha = opacity * .65f), RoundedCornerShape(4.dp)))
    }
}

