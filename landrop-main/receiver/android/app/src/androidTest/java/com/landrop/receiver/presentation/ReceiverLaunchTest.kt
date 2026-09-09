package com.landrop.receiver.presentation

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.landrop.receiver.R
import com.landrop.receiver.platform.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReceiverLaunchTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun launchesWithReceiverBrandingAndDisconnectedStatus() {
        compose.onNodeWithText(compose.activity.getString(R.string.app_name))
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText(compose.activity.getString(R.string.not_connected))
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText(compose.activity.getString(R.string.foundation_notice))
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun retainsTheFoundationScreenAfterActivityRecreation() {
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText(compose.activity.getString(R.string.app_name))
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText(compose.activity.getString(R.string.not_connected))
            .performScrollTo()
            .assertIsDisplayed()
    }
}
