package kz.parkly.demo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import kz.parkly.demo.updates.UpdatesPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdatesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
