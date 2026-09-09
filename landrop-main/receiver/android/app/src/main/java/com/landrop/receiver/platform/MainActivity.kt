package com.landrop.receiver.platform

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.landrop.receiver.application.ReceiverState
import com.landrop.receiver.presentation.ReceiverScreen
import com.landrop.receiver.presentation.theme.LanDropTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            LanDropTheme {
                ReceiverScreen(state = ReceiverState())
            }
        }
    }
}
