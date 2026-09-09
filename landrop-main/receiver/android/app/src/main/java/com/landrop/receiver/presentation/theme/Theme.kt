package com.landrop.receiver.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LanDropColors = darkColorScheme(
    primary = Color(0xFF74EFCB),
    onPrimary = Color(0xFF06382C),
    primaryContainer = Color(0xFF183D34),
    onPrimaryContainer = Color(0xFFD5FFF0),
    secondary = Color(0xFFB4C8DF),
    background = Color(0xFF0B111B),
    onBackground = Color(0xFFEEF3FA),
    surface = Color(0xFF111B29),
    onSurface = Color(0xFFEEF3FA),
    surfaceVariant = Color(0xFF1B2A3B),
    onSurfaceVariant = Color(0xFFB5C3D5),
    outline = Color(0xFF536478),
)

@Composable
fun LanDropTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LanDropColors,
        typography = Typography(),
        content = content,
    )
}
